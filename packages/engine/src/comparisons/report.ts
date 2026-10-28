import {
  ARM_LABELS,
  ARM_PRIORITY,
  COMPARISON_REPORT_FORMAT,
  ComparisonReportSchema,
  type AdapterCell,
  type ArmCaps,
  type ArmId,
  type ArmReport,
  type ArmRow,
  type BackendId,
  type BackendTable,
  type ComparisonReport,
  type Job,
  type Paired,
  type RepeatRow,
  type RuntimeIdentity,
  type Spend,
  type TaskSweep,
} from '@architect/shared';
import { configurationKey } from '../loop/configuration';
import type { LoopDeps } from '../loop/deps';
import { settleExperimentCompute } from '../loop/experiments';
import { frozenConfig } from '../loop/graduation';
import { isHeld } from '../loop/protocol';
import { TRAINING_ENDED } from '../loop/run-state';
import { percentile } from '../report/report-card';
import type { EngineStore } from '../store/engine-store';
import type { StoredAttempt, StoredRun } from '../store/records';
import { computeSoFar } from '../training/budget';
import type { ComparisonEngine } from './engine';
import { ARM_ORDER, type ComparisonConfig } from './projection';
import type { PlanRecord, SweepAttempt } from './records';
import { counted, paired } from './stats';

export interface ReportInput {
  engine: ComparisonEngine;
  deps: LoopDeps;
  config: ComparisonConfig;
  plan: PlanRecord | null;
  base: Job;
  calibration: readonly SweepAttempt[];
  regression: { job: Job; attempts: readonly SweepAttempt[] } | null;
  dryRun: boolean;
  commit: string | null;
  now: string;
}

/** The run an arm started, found by the arm its protocol names. */
export function armRun(store: EngineStore, arm: ArmId): StoredRun | null {
  return store.runs.list().find((record) => record.protocol?.arm === arm) ?? null;
}

const UNKNOWN_IDENTITY = (runtime: string): RuntimeIdentity => ({
  model: 'not recorded',
  provider: null,
  runtime,
  quantization: null,
  ggufSha256: null,
  runtimeBuild: null,
  chatTemplate: null,
  contextLength: null,
});

const BACKEND_LABELS: Record<BackendId, string> = {
  hosted: 'Hosted Glimmer',
  reference: 'Spark as a reference',
  'local-ollama': "This computer's Glimmer on Ollama",
  'local-llama.cpp': "This computer's Glimmer with adapters on llama-server",
};

/** Counts by task type, in the job's order. */
function perTypeOf(job: Job, results: readonly { type: string; pass: boolean }[]) {
  return job.taskTypes.flatMap(({ id, label }) => {
    const ofType = results.filter((result) => result.type === id);
    if (ofType.length === 0) return [];
    return [
      { type: id, label, ...counted(ofType.filter((result) => result.pass).length, ofType.length) },
    ];
  });
}

function latencyOf(values: readonly number[]) {
  return values.length === 0 ? null : { p50: percentile(values, 50), p95: percentile(values, 95) };
}

/** A sweep's summary: the bare student on tasks outside any arm. */
function sweepSummary(
  job: Job,
  attempts: readonly SweepAttempt[],
  backend: BackendId,
): TaskSweep | null {
  if (attempts.length === 0) return null;
  const priced = attempts.filter((attempt) => attempt.usd !== null);
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    job: job.name,
    tasks: attempts.length,
    backend,
    scenarios: counted(attempts.filter((attempt) => attempt.pass).length, attempts.length),
    perType: perTypeOf(
      job,
      attempts.map((attempt) => ({ type: attempt.taskType, pass: attempt.pass })),
    ),
    latencyMs: latencyOf(attempts.map((attempt) => attempt.latencyMs)),
    meanUsdPerAttempt: priced.length === 0 ? null : mean(priced.map((attempt) => attempt.usd ?? 0)),
    meanInputTokens: mean(attempts.map((attempt) => attempt.usage.inputTokens)),
    meanOutputTokens: mean(attempts.map((attempt) => attempt.usage.outputTokens)),
  };
}

/** One evaluation's attempts: a run's locked test on a target, under a configuration and seed. */
interface Slice {
  arm: ArmId;
  run: StoredRun;
  target: 'hosted' | 'local';
  config: string;
  seed: number;
}

function attemptsOf(store: EngineStore, slice: Slice): StoredAttempt[] {
  return store.attempts
    .list({ runId: slice.run.run.id, split: 'test', target: slice.target, config: slice.config })
    .filter((attempt) => attempt.seed === slice.seed);
}

function rowOf(input: ReportInput, slice: Slice): ArmRow | null {
  const { store } = input.engine;
  const attempts = attemptsOf(store, slice);
  if (attempts.length === 0) return null;
  const measured = store.runtimeMeasurements
    .list(slice.run.run.id)
    .filter(
      (item) =>
        item.split === 'test' && item.target === slice.target && item.config === slice.config,
    );
  const peak = (values: readonly (number | null)[]) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length === 0 ? null : Math.max(...known);
  };
  const frozen = slice.run.freeze;
  const adapter = frozen?.configuration?.adapter ?? null;
  return {
    arm: slice.arm,
    label: ARM_LABELS[slice.arm],
    runId: slice.run.run.id,
    seed: slice.seed,
    scenarios: counted(attempts.filter((attempt) => attempt.check.pass).length, attempts.length),
    perType: perTypeOf(
      input.base,
      attempts.map((attempt) => ({ type: attempt.taskType, pass: attempt.check.pass })),
    ),
    refusals: attempts.filter((attempt) => attempt.stopReason === 'refused').length,
    latencyMs: latencyOf(attempts.map((attempt) => attempt.latencyMs)),
    coldStartMs: measured.find((item) => item.coldStartMs !== null)?.coldStartMs ?? null,
    peakMemory:
      measured.length === 0
        ? null
        : {
            processBytes: peak(measured.map((item) => item.peakProcessBytes)),
            gpuBytes: peak(measured.map((item) => item.peakGpuBytes)),
          },
    harnessHash: frozen?.harnessHash ?? null,
    adapterSha256: slice.arm === 'reference' ? null : (adapter?.sha256 ?? null),
    sampling: frozen?.configuration?.decoding ?? null,
    complete: attempts.length >= input.base.splits.test,
  };
}

/** Pass or fail per scenario, for pairing. */
function outcomes(store: EngineStore, slice: Slice): Map<string, boolean> {
  return new Map(attemptsOf(store, slice).map((attempt) => [attempt.taskId, attempt.check.pass]));
}

function pairOf(input: ReportInput, a: Slice, b: Slice): Paired | null {
  const { store } = input.engine;
  const left = outcomes(store, a);
  const right = outcomes(store, b);
  const all = paired(left, right);
  if (all.scenarios === 0) return null;
  const tasks = new Map(
    attemptsOf(store, a).map((attempt) => [attempt.taskId, attempt.taskType] as const),
  );
  const byType = input.base.taskTypes.flatMap(({ id }) => {
    const ids = new Set([...tasks].filter(([, type]) => type === id).map(([task]) => task));
    const pick = (map: Map<string, boolean>) => new Map([...map].filter(([task]) => ids.has(task)));
    const counts = paired(pick(left), pick(right));
    if (counts.scenarios === 0) return [];
    const { scenarios: _scenarios, ...rest } = counts;
    return [{ type: id, ...rest }];
  });
  return { a: a.arm, b: b.arm, seed: a.seed, ...all, byType };
}

/** Where each arm's own locked test ran, as configuration and target; null before its test. */
function ownSlice(arm: ArmId, run: StoredRun, seed: number): Slice | null {
  const frozen = run.freeze;
  if (frozen === null) return null;
  return {
    arm,
    run,
    target: run.lockedTestOn,
    config: configurationKey(frozenConfig(frozen)),
    seed,
  };
}

function backendOf(slice: Slice): BackendId {
  if (slice.config.startsWith('reference/')) return 'reference';
  if (slice.target === 'hosted') return 'hosted';
  return slice.config.startsWith('student/llama.cpp') ? 'local-llama.cpp' : 'local-ollama';
}

/** Contrasts worth pairing, in this order; any pair missing an arm is left out. */
const CONTRASTS: readonly [ArmId, ArmId][] = [
  ['draft', 'bare'],
  ['targeted', 'bare'],
  ['targeted', 'draft'],
  ['fixed', 'bare'],
  ['targeted', 'fixed'],
  ['weights-one-shot', 'bare'],
  ['weights-targeted', 'bare'],
  ['weights-targeted', 'weights-one-shot'],
  ['reference', 'bare'],
  ['reference', 'draft'],
  ['reference', 'targeted'],
  ['reference', 'fixed'],
];

function repeatRow(input: ReportInput, slices: readonly Slice[]): RepeatRow | null {
  const { store } = input.engine;
  const [first] = slices;
  if (first === undefined || slices.length < 2) return null;
  const maps = slices.map((slice) => outcomes(store, slice));
  if (maps.some((map) => map.size === 0)) return null;
  const tasks = [...(maps[0] ?? new Map<string, boolean>()).keys()].filter((task) =>
    maps.every((map) => map.has(task)),
  );
  const every = tasks.filter((task) => maps.every((map) => map.get(task) === true)).length;
  const flipped = tasks.filter((task) => new Set(maps.map((map) => map.get(task))).size > 1).length;
  return {
    arm: first.arm,
    label: ARM_LABELS[first.arm],
    seeds: slices.map((slice, index) => {
      const map = maps[index] ?? new Map<string, boolean>();
      return {
        seed: slice.seed,
        score: { pass: [...map.values()].filter(Boolean).length, total: map.size },
      };
    }),
    everySeed: counted(every, tasks.length),
    flipped,
  };
}

/** Every backend table: rows under the first declared seed, pairs within the table, repeats apart. */
function backendTables(input: ReportInput): BackendTable[] {
  const { store } = input.engine;
  const [firstSeed = 0, ...repeatSeeds] = input.config.testSeeds;
  const slices: Slice[] = [];
  for (const arm of ARM_ORDER) {
    if (arm === 'reference' || arm === 'repeat') continue;
    const run = armRun(store, arm);
    if (run === null) continue;
    const own = ownSlice(arm, run, firstSeed);
    if (own === null) continue;
    slices.push(own);
    // A re-test on this computer of a graduate whose own test was hosted.
    if (run.lockedTestOn === 'hosted' && store.retests.get(run.run.id, 'local') !== null) {
      slices.push({ ...own, target: 'local' });
    }
  }
  const bare = armRun(store, 'bare');
  const reference = bare === null ? null : store.references.get(bare.run.id, 'test');
  if (bare !== null && reference !== null) {
    slices.push({
      arm: 'reference',
      run: bare,
      target: bare.lockedTestOn,
      config: reference.configKey,
      seed: firstSeed,
    });
  }
  const tables: BackendTable[] = [];
  for (const backend of ['hosted', 'reference', 'local-ollama', 'local-llama.cpp'] as const) {
    const inTable = slices.filter((slice) => backendOf(slice) === backend);
    const rows = inTable.flatMap((slice) => rowOf(input, slice) ?? []);
    if (rows.length === 0) continue;
    // Spark pairs with the hosted arms on the same tasks and seed: a reference, labelled so.
    const partners =
      backend === 'reference' ? slices.filter((s) => backendOf(s) === 'hosted') : inTable;
    const paired = CONTRASTS.flatMap(([a, b]) => {
      const left = inTable.find((slice) => slice.arm === a);
      const right = partners.find((slice) => slice.arm === b);
      if (left === undefined || right === undefined) return [];
      return pairOf(input, left, right) ?? [];
    });
    const repeats = inTable.flatMap((slice) => {
      if (slice.arm === 'reference') return [];
      return repeatRow(input, [slice, ...repeatSeeds.map((seed) => ({ ...slice, seed }))]) ?? [];
    });
    tables.push({
      backend,
      label: BACKEND_LABELS[backend],
      identity: input.plan?.identities[backend] ?? UNKNOWN_IDENTITY(backend),
      rows,
      paired,
      repeats,
    });
  }
  return tables;
}

/** Student dollars and tokens of a run's attempts that `keep` selects. */
function studentLines(
  store: EngineStore,
  runId: string,
  keep: (attempt: StoredAttempt) => boolean,
) {
  const attempts = new Map(store.attempts.list({ runId }).map((attempt) => [attempt.id, attempt]));
  const costs = store.costs.list(runId).filter((cost) => {
    if (cost.role !== 'student') return false;
    const attempt = cost.attemptId === null ? undefined : attempts.get(cost.attemptId);
    return attempt !== undefined && keep(attempt);
  });
  return {
    usd: costs.some((cost) => cost.usd === null)
      ? null
      : costs.reduce((sum, cost) => sum + (cost.usd ?? 0), 0),
    inputTokens: costs.reduce((sum, cost) => sum + cost.usage.inputTokens, 0),
    outputTokens: costs.reduce((sum, cost) => sum + cost.usage.outputTokens, 0),
    attempts: [...attempts.values()].filter(
      (attempt) => keep(attempt) && attempt.config?.startsWith('reference/') !== true,
    ).length,
  };
}

const NO_SPEND: Spend = {
  sparkUsd: 0,
  sparkInputTokens: 0,
  sparkOutputTokens: 0,
  studentUsd: 0,
  studentInputTokens: 0,
  studentOutputTokens: 0,
  computeUsd: 0,
  computeMinutes: 0,
  computeSettled: true,
  examples: 0,
  trainedTokens: 0,
  studentAttempts: 0,
  sparkAttempts: 0,
  wallMinutes: 0,
};

/** What an arm spent, each line apart, from the run's ledger, attempts and training jobs. */
function spendOf(input: ReportInput, arm: ArmId): Spend {
  const { store } = input.engine;
  const deferred = new Set(input.config.testSeeds.slice(1));
  const isRepeat = (attempt: StoredAttempt) =>
    attempt.split === 'test' && deferred.has(attempt.seed);
  if (arm === 'repeat') {
    const lines = (['bare', 'draft', 'targeted'] as const).flatMap((source) => {
      const run = armRun(store, source);
      return run === null ? [] : [studentLines(store, run.run.id, isRepeat)];
    });
    const usd = lines.some((line) => line.usd === null)
      ? null
      : lines.reduce((sum, line) => sum + (line.usd ?? 0), 0);
    return {
      ...NO_SPEND,
      studentUsd: usd,
      studentInputTokens: lines.reduce((sum, line) => sum + line.inputTokens, 0),
      studentOutputTokens: lines.reduce((sum, line) => sum + line.outputTokens, 0),
      studentAttempts: lines.reduce((sum, line) => sum + line.attempts, 0),
    };
  }
  if (arm === 'reference') {
    const bare = armRun(store, 'bare');
    const record = bare === null ? null : store.references.get(bare.run.id, 'test');
    if (bare === null || record === null) return NO_SPEND;
    const attempts = store.attempts
      .list({ runId: bare.run.id, split: 'test' })
      .filter((attempt) => attempt.config === record.configKey);
    return {
      ...NO_SPEND,
      sparkUsd: record.spentUsd,
      sparkInputTokens: record.inputTokens,
      sparkOutputTokens: record.outputTokens,
      sparkAttempts: attempts.length,
    };
  }
  const run = armRun(store, arm);
  if (run === null) return NO_SPEND;
  const runId = run.run.id;
  const mentor = store.costs.list(runId).filter((cost) => cost.role === 'mentor');
  const student = studentLines(store, runId, (attempt) => !isRepeat(attempt));
  const jobs = input.deps.training?.worker.list().filter((job) => job.scope === runId) ?? [];
  const compute = jobs.map((job) => computeSoFar(job));
  return {
    sparkUsd: mentor.reduce((sum, cost) => sum + (cost.usd ?? 0), 0),
    sparkInputTokens: mentor.reduce((sum, cost) => sum + cost.usage.inputTokens, 0),
    sparkOutputTokens: mentor.reduce((sum, cost) => sum + cost.usage.outputTokens, 0),
    studentUsd: student.usd,
    studentInputTokens: student.inputTokens,
    studentOutputTokens: student.outputTokens,
    computeUsd: compute.reduce((sum, line) => sum + line.usd, 0),
    computeMinutes: compute.reduce((sum, line) => sum + line.seconds / 60, 0),
    computeSettled: compute.every((line) => line.settled),
    examples: jobs.reduce((sum, job) => sum + job.dataset.exampleCount, 0),
    trainedTokens: jobs.reduce(
      (sum, job) => sum + (input.deps.training?.trainedTokens(job) ?? 0),
      0,
    ),
    studentAttempts: student.attempts,
    sparkAttempts: store.lessons.list({ runId }).length,
    wallMinutes: run.run.totals.wallMs / 60_000,
  };
}

/** What ends training before its plan did: a stop, a cap, a refusal. */
const CUT_SHORT: ReadonlySet<keyof typeof TRAINING_ENDED> = new Set([
  'user',
  'usd',
  'wall_clock',
  'leak',
  'rejected',
  'error',
  'contract',
]);

/** The status of an arm and why, from its records and the runner's decisions. */
function statusOf(
  input: ReportInput,
  arm: ArmId,
): { status: ArmReport['status']; reason: string | null } {
  const { store } = input.engine;
  const decision = [...(input.plan?.decisions ?? [])].reverse().find((item) => item.arm === arm);
  const projected = input.plan?.projection.arms.find((item) => item.arm === arm);
  const dropped = () => ({
    status: 'not_run' as const,
    reason:
      decision?.reason ??
      projected?.reason ??
      (input.plan === null ? 'No plan was confirmed.' : 'It was not asked for.'),
  });
  if (arm === 'reference' || arm === 'repeat') {
    const sources = (arm === 'reference' ? ['bare'] : ['bare', 'draft', 'targeted']) as ArmId[];
    const records = sources.flatMap((source) => {
      const run = armRun(store, source);
      if (run === null) return [];
      const target = run.lockedTestOn;
      const record =
        arm === 'reference'
          ? store.references.get(run.run.id, 'test')
          : store.repeats.get(run.run.id, target);
      return record === null ? [] : [record];
    });
    if (records.length === 0) return dropped();
    if (records.every((record) => record.status === 'finished')) {
      // The runner cut it short: the credit didn't pay for every arm's repeat.
      if (decision?.kind === 'stopped') return { status: 'stopped', reason: decision.reason };
      return { status: 'complete', reason: null };
    }
    const paused = records.find((record) => record.status === 'paused');
    return {
      status: 'incomplete',
      reason: paused?.error ?? 'It is still running.',
    };
  }
  const run = armRun(store, arm);
  if (run === null) return dropped();
  const stopped = decision?.kind === 'stopped' ? decision.reason : null;
  const ended = run.run.stopReason;
  switch (run.run.status) {
    case 'finished':
      if (stopped !== null) return { status: 'stopped', reason: stopped };
      // A cap or a refusal that ended training cut the arm short; meeting the target or using
      // every round didn't.
      if (ended !== undefined && CUT_SHORT.has(ended)) {
        return { status: 'stopped', reason: TRAINING_ENDED[ended] };
      }
      return { status: 'complete', reason: null };
    case 'stopped':
      return {
        status: 'stopped',
        reason: stopped ?? 'Stopped before any change was kept, so it has no graduate to test.',
      };
    case 'failed':
      return { status: 'incomplete', reason: run.run.error ?? 'The run failed.' };
    default:
      if (isHeld(run)) {
        if (stopped !== null) return { status: 'stopped', reason: stopped };
        return { status: 'incomplete', reason: "Frozen; its locked test wasn't released yet." };
      }
      return { status: 'incomplete', reason: run.run.error ?? `The run is ${run.run.status}.` };
  }
}

function capsOf(input: ReportInput, arm: ArmId, job: Job | null): ArmCaps {
  const student = input.plan?.studentCaps[arm] ?? null;
  if (arm === 'reference') {
    return {
      sparkUsd: input.config.sparkCaps.reference,
      studentUsd: null,
      computeUsd: null,
      wallMinutes: null,
      rounds: null,
    };
  }
  if (job === null) {
    return {
      sparkUsd: null,
      studentUsd: student,
      computeUsd: null,
      wallMinutes: null,
      rounds: null,
    };
  }
  return {
    sparkUsd: job.budget.maxMentorUsd,
    studentUsd: student,
    computeUsd: job.budget.maxComputeUsd ?? null,
    wallMinutes: job.budget.maxWallMinutes,
    rounds: arm === 'bare' ? null : job.budget.maxRounds,
  };
}

function notesOf(input: ReportInput, arm: ArmId, run: StoredRun | null, job: Job | null): string[] {
  const { store } = input.engine;
  const notes: string[] = [];
  const draft = armRun(store, 'draft');
  switch (arm) {
    case 'draft': {
      const kept =
        run !== null &&
        store.rounds
          .list(run.run.id)
          .some(({ round }) => round.index === 1 && round.decision === 'kept');
      if (run !== null && run.freeze !== null && !kept) {
        notes.push(
          'Its draft was refused even after its fix, so it froze the blank harness: its results are the bare harness again, not a draft.',
        );
      }
      break;
    }
    case 'targeted':
    case 'fixed':
      if (job?.startingHarness.kind === 'import' && draft !== null) {
        notes.push(
          `Starts from the draft arm's kept harness (version ${draft.freeze?.harnessVersion ?? '?'}), as decision 026 shares it; the draft's Spark spend is the draft arm's and came off this arm's cap.`,
        );
      } else if (run !== null) {
        notes.push('The draft arm kept no draft, so this arm drafted for itself.');
      }
      if (arm === 'fixed') {
        notes.push(
          `Its mentor could choose only ${run?.protocol?.interventions?.join(' or ') ?? input.config.fixedIntervention} interventions; everything else matched the targeted arm.`,
        );
      }
      break;
    case 'weights-one-shot':
    case 'weights-targeted':
      notes.push(
        "Its H0 is the blank harness the bare arm runs; its H1 is the targeted arm's frozen harness, adopted whole in round 1 and kept whatever it scored.",
      );
      notes.push(
        arm === 'weights-one-shot'
          ? `One adapter trained on verified demonstrations of ${input.config.oneShotPerType} train tasks of each type, chosen by seed, never from a failure; kept as measured unless a hard gate failed.`
          : 'Training rounds only: its mentor could choose no harness change, and each adapter faced the keep rule.',
      );
      notes.push(
        run?.freeze?.configuration?.adapter
          ? 'Adapters run only on this computer, so its locked test ran here, on llama-server with its adapter.'
          : 'It kept no adapter, so its locked test ran on this computer on Ollama, as a graduate without one runs.',
      );
      break;
    case 'reference':
      notes.push(
        "Spark acted as the agent with the bare arm's frozen harness (blank), the same tools and limits, on the same locked-test tasks under the first seed. It is a reference, not an arm: nothing it did reached mentoring, and it was graded by the same checker.",
      );
      break;
    case 'repeat':
      notes.push(
        `The frozen bare, draft and targeted graduates took the locked test again under seed ${input.config.testSeeds.slice(1).join(' and ')}, declared before any run. Repeats are reported as repeats, never as more scenarios.`,
      );
      break;
    default:
      break;
  }
  return notes;
}

function armReport(input: ReportInput, arm: ArmId, job: Job | null): ArmReport {
  const { store } = input.engine;
  const run = arm === 'reference' || arm === 'repeat' ? null : armRun(store, arm);
  const { status, reason } = statusOf(input, arm);
  const frozen = run?.freeze ?? null;
  const adapter = frozen?.configuration?.adapter ?? null;
  return {
    arm,
    label: ARM_LABELS[arm],
    priority: ARM_PRIORITY[arm],
    status,
    reason,
    runId: run?.run.id ?? null,
    notes: notesOf(input, arm, run, job),
    caps: capsOf(input, arm, job),
    spent: spendOf(input, arm),
    dev: { baseline: run?.run.devBaseline ?? null, final: run?.run.devCurrent ?? null },
    experiments:
      run === null
        ? []
        : store.experiments.list(run.run.id).map((experiment) => ({
            round: experiment.round,
            kind: experiment.kind,
            title: experiment.title,
            disposition: experiment.disposition,
            devBefore: experiment.devBefore,
            devAfter: experiment.devAfter,
            regressions: experiment.regressions,
            reason: experiment.reason,
          })),
    frozen:
      frozen === null
        ? null
        : {
            harnessVersion: frozen.harnessVersion,
            harnessHash: frozen.harnessHash,
            backend: frozen.configuration?.backend ?? 'not recorded',
            adapter:
              adapter === null
                ? null
                : {
                    id: adapter.id,
                    sha256: adapter.sha256,
                    scale: adapter.scale,
                    baseDigest: adapter.baseDigest ?? null,
                    standIn: adapter.standIn,
                  },
            testSeeds: frozen.testSeeds ?? [],
            decoding: frozen.configuration?.decoding ?? null,
          },
  };
}

function adapterCells(input: ReportInput): AdapterCell[] {
  const { store } = input.engine;
  return (['weights-one-shot', 'weights-targeted'] as const).flatMap((arm) => {
    const run = armRun(store, arm);
    if (run === null) return [];
    return store.experiments
      .list(run.run.id)
      .filter((experiment) => experiment.kind === 'weights')
      .flatMap((experiment) =>
        experiment.measurements.map((measurement) => ({
          arm,
          round: experiment.round,
          label: measurement.label,
          harnessVersion: measurement.configuration.harnessVersion,
          adapter: measurement.configuration.adapter,
          backend: measurement.configuration.backend,
          seeds: measurement.seeds,
          score: counted(measurement.score.pass, measurement.score.total),
          latencyMs: measurement.latencyMs,
          provenance: measurement.provenance,
        })),
      );
  });
}

function money(usd: number | null): string {
  return usd === null ? 'unknown' : `$${usd.toFixed(2)}`;
}

/** A cap, where null means the arm had none of that kind. */
function cap(usd: number | null): string {
  return usd === null ? 'no cap' : `$${usd.toFixed(2)}`;
}

/** What a reader needs before trusting a number, made from the same records as the tables. */
function disclosures(
  input: ReportInput,
  arms: readonly ArmReport[],
  backends: readonly BackendTable[],
): string[] {
  const lines: string[] = [];
  if (input.dryRun) {
    lines.push(
      'This is a dry run on fakes: no model was called, nothing was trained, and no number in it describes Glimmer or Spark.',
    );
  }
  lines.push(
    'Claims rest on the locked test alone. Dev gains were picked by the keep rule, so they lean upward and are not claimed.',
  );
  lines.push(
    `Every arm ran with one mentoring seed (${input.config.mentoringSeed}); the locked test ran under seed ${input.config.testSeeds[0]}, and seed ${input.config.testSeeds.slice(1).join(', ')} is a decoding repeat, never more scenarios.`,
  );
  const budgets = arms
    .filter((arm) => arm.status !== 'not_run')
    .map(
      (arm) =>
        `${arm.label}: Spark ${money(arm.spent.sparkUsd)} of ${cap(arm.caps.sparkUsd)}, student ${money(arm.spent.studentUsd)} of ${cap(arm.caps.studentUsd)}, compute ${money(arm.spent.computeUsd)} of ${cap(arm.caps.computeUsd)}${arm.spent.examples > 0 ? `, ${arm.spent.examples} examples and ${arm.spent.trainedTokens} trained tokens` : ''}`,
    );
  if (budgets.length > 0) {
    lines.push(
      `The arms' budgets differ and are not equal-budget comparisons. ${budgets.join('; ')}.`,
    );
  }
  if (arms.some((arm) => !arm.spent.computeSettled)) {
    lines.push(
      "Some compute is a training job's whole authorization: the job had not ended when this report was made, so its cost may be lower.",
    );
  }
  const weightsRan = arms.some((arm) => arm.arm.startsWith('weights-') && arm.status !== 'not_run');
  if (!weightsRan) {
    lines.push(
      'Harness-only graduate. Remote QLoRA training and adapter loading are built; real end-to-end training is not validated. A01 is blocked without Hugging Face credentials.',
    );
  } else {
    lines.push(
      "Adapters trained against NF4 weights loaded from the bf16 checkpoint and were measured only on this computer's 2-bit build; no bf16 evaluation of an adapter exists, so a gain's transfer from bf16 is not stated.",
    );
  }
  if (
    !backends.some(
      (table) => table.backend === 'local-ollama' || table.backend === 'local-llama.cpp',
    )
  ) {
    lines.push(
      'Local evaluation incomplete: no locked test ran on this computer, so no result here describes the 2-bit build the graduate runs on.',
    );
  }
  const hosted = backends.find((table) => table.backend === 'hosted');
  if (hosted !== undefined) {
    lines.push(
      `Hosted results ran on ${hosted.identity.provider ?? 'the hosted copy'} (${hosted.identity.quantization ?? 'precision not reported'}); this computer runs a 2-bit build, so hosted and local tables are never compared row to row.`,
    );
  }
  if (arms.some((arm) => arm.arm === 'reference' && arm.status !== 'not_run')) {
    lines.push(
      "Spark's row is a reference on the same tasks, tools, limits and seed, not an arm: it never judged anything.",
    );
  }
  return lines;
}

/**
 * The comparisons report, from the store and the runner's files alone. Compute of training jobs
 * that ended since their experiment was written is settled first, so it shows what they cost.
 */
export async function buildReport(input: ReportInput): Promise<ComparisonReport> {
  const { store, jobs } = input.engine;
  for (const arm of ARM_ORDER) {
    const run = armRun(store, arm);
    if (run !== null) settleExperimentCompute(store, input.deps.training, run.run.id);
  }
  const arms: ArmReport[] = [];
  for (const arm of ARM_ORDER) {
    const requested = input.plan?.arms.includes(arm) ?? input.config.arms.includes(arm);
    if (!requested) continue;
    const run = arm === 'reference' || arm === 'repeat' ? null : armRun(store, arm);
    const job = run === null ? null : await jobs.forRun(run);
    arms.push(armReport(input, arm, job));
  }
  const backends = backendTables(input);
  const report: ComparisonReport = {
    format: COMPARISON_REPORT_FORMAT,
    generatedAt: input.now,
    dryRun: input.dryRun,
    commit: input.commit,
    job: {
      id: input.base.id,
      name: input.base.name,
      splitsSeed: input.base.splits.seed,
      counts: {
        calibration: input.base.splits.calibration,
        train: input.base.splits.train,
        dev: input.base.splits.dev,
        test: input.base.splits.test,
      },
    },
    plan: {
      mentoringSeed: input.config.mentoringSeed,
      testSeeds: [...input.config.testSeeds],
      order: [...ARM_ORDER],
    },
    calibration: sweepSummary(input.base, input.calibration, 'hosted'),
    regression:
      input.regression === null
        ? null
        : sweepSummary(input.regression.job, input.regression.attempts, 'hosted'),
    projection: input.plan?.projection ?? null,
    arms,
    backends,
    adapters: adapterCells(input),
    disclosures: disclosures(input, arms, backends),
  };
  return ComparisonReportSchema.parse(report);
}
