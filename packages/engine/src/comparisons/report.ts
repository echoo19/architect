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
  type CreditSummary,
  type Job,
  type OrgTypeResult,
  type Paired,
  type PassTarget,
  type RepeatRow,
  type RunStatus,
  type RunStopReason,
  type RuntimeIdentity,
  type Spend,
  type StudyRecord,
  type TaskSweep,
} from '@architect/shared';
import { configurationKey } from '../loop/configuration';
import type { LoopDeps } from '../loop/deps';
import { settleExperimentCompute } from '../loop/experiments';
import { frozenConfig, withoutAdapterConfig } from '../loop/graduation';
import { isHeld } from '../loop/protocol';
import { TRAINING_ENDED } from '../loop/run-state';
import { percentile } from '../report/report-card';
import type { EngineStore } from '../store/engine-store';
import type { StoredAttempt, StoredRun } from '../store/records';
import { computeSoFar } from '../training/budget';
import type { ComparisonEngine } from './engine';
import { lockedTestsOf, type Field } from './field';
import { plainStrings } from './plain';
import { ARM_ORDER, billingOf, type ComparisonConfig } from './projection';
import type { PlanRecord, SweepAttempt } from './records';
import { counted, paired, pairedDifference, percent, wilson } from './stats';

export interface ReportInput {
  engine: ComparisonEngine;
  deps: LoopDeps;
  config: ComparisonConfig;
  plan: PlanRecord | null;
  base: Job;
  /** The job's organizations as its folder lists them; none for a one-organization job. */
  field: Field;
  /** Spark's study of a field job's organizations, which every arm shared; null for any other. */
  study: StudyRecord | null;
  calibration: readonly SweepAttempt[];
  regression: { job: Job; attempts: readonly SweepAttempt[] } | null;
  /** The request journal's account of the student's credit; null when nothing read it. */
  credit: CreditSummary | null;
  dryRun: boolean;
  commit: string | null;
  now: string;
}

/** The run an arm started, found by the arm its protocol names. */
export function armRun(store: EngineStore, arm: ArmId): StoredRun | null {
  return store.runs.list().find((record) => record.protocol?.arm === arm) ?? null;
}

/**
 * The settings the report says the comparison ran with. The plan as confirmed wins over the
 * request, so a report asked for without the flags of the run still says what ran.
 */
function declared(input: ReportInput) {
  const settings = input.plan?.settings;
  return {
    mentoringSeed: settings?.mentoringSeed ?? input.config.mentoringSeed,
    testSeeds: settings?.testSeeds ?? input.config.testSeeds,
    adapterProtocol: settings?.adapterProtocol ?? input.config.adapterProtocol,
    realCompute: settings?.realCompute ?? input.config.realCompute,
  };
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

/** Each Spark reference and the arm whose frozen graduate it acted with (decision 051). */
const REFERENCE_ON: Partial<Record<ArmId, ArmId>> = {
  reference: 'bare',
  'reference-targeted': 'targeted',
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
  label: string,
  job: Job,
  attempts: readonly SweepAttempt[],
  backend: BackendId,
): TaskSweep | null {
  if (attempts.length === 0) return null;
  const costs = attempts.flatMap((attempt) => (attempt.usd === null ? [] : [attempt.usd]));
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    label,
    job: job.name,
    tasks: attempts.length,
    backend,
    scenarios: counted(attempts.filter((attempt) => attempt.pass).length, attempts.length),
    perType: perTypeOf(
      job,
      attempts.map((attempt) => ({ type: attempt.taskType, pass: attempt.pass })),
    ),
    latencyMs: latencyOf(attempts.map((attempt) => attempt.latencyMs)),
    // An attempt of unknown cost leaves the mean unknown rather than lower.
    meanUsdPerAttempt: costs.length < attempts.length ? null : mean(costs),
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
  /** Which of the arm's configurations, when it has more than one locked result. */
  configuration: string | null;
}

function labelOf(slice: Slice): string {
  return slice.configuration === null
    ? ARM_LABELS[slice.arm]
    : `${ARM_LABELS[slice.arm]}, ${slice.configuration}`;
}

function attemptsOf(store: EngineStore, slice: Slice): StoredAttempt[] {
  return store.attempts
    .list({ runId: slice.run.run.id, split: 'test', target: slice.target, config: slice.config })
    .filter((attempt) => attempt.seed === slice.seed);
}

/** Whether a task is of an organization the job never trains on. */
function unseen(input: ReportInput, taskId: string): boolean {
  const org = input.field.orgOf.get(taskId);
  return input.field.organizations.some((item) => item.id === org && item.role === 'transfer');
}

/**
 * Each task type at each organization, in the job's type order and the organizations' order:
 * seen when the job trains on it. Empty for a one-organization job.
 */
function perOrgOf(input: ReportInput, attempts: readonly StoredAttempt[]): OrgTypeResult[] {
  return input.base.taskTypes.flatMap((type) =>
    input.field.organizations.flatMap((org) => {
      const here = attempts.filter(
        (attempt) =>
          attempt.taskType === type.id && input.field.orgOf.get(attempt.taskId) === org.id,
      );
      if (here.length === 0) return [];
      return [
        {
          type: type.id,
          label: type.label,
          org: org.id,
          orgName: org.name,
          seen: org.role === 'train',
          synthetic: org.synthetic,
          pass: here.filter((attempt) => attempt.check.pass).length,
          total: here.length,
        },
      ];
    }),
  );
}

/** The job's target as observed counts: met only by a whole test with enough passes. */
function passTargetOf(input: ReportInput, pass: number, total: number): PassTarget {
  const passRate = input.base.requirements.passRate;
  const of = input.base.splits.test;
  const needed = Math.ceil(passRate * of - 1e-9);
  return { passRate, needed, of, met: total >= of && pass >= needed };
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
  // The adapter applied: none for Spark, and none for a paired test run without it.
  const applied = frozen !== null && slice.config === configurationKey(frozenConfig(frozen));
  const adapter = frozen?.configuration?.adapter ?? null;
  const pass = attempts.filter((attempt) => attempt.check.pass).length;
  // The target is judged on the organizations it trained on; one it never saw is reported apart.
  const judged = attempts.filter((attempt) => !unseen(input, attempt.taskId));
  const perOrg = perOrgOf(input, attempts);
  return {
    arm: slice.arm,
    label: labelOf(slice),
    runId: slice.run.run.id,
    configuration: slice.configuration,
    seed: slice.seed,
    scenarios: counted(pass, attempts.length),
    passTarget: passTargetOf(
      input,
      judged.filter((attempt) => attempt.check.pass).length,
      judged.length,
    ),
    perType: perTypeOf(
      input.base,
      attempts.map((attempt) => ({ type: attempt.taskType, pass: attempt.check.pass })),
    ),
    ...(perOrg.length === 0 ? {} : { perOrg }),
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
    adapterSha256: applied ? (adapter?.sha256 ?? null) : null,
    sampling: frozen?.configuration?.decoding ?? null,
    complete: attempts.length >= lockedTestsOf(input.base, input.config),
  };
}

/** Pass or fail per scenario, for pairing. */
function outcomes(store: EngineStore, slice: Slice): Map<string, boolean> {
  return new Map(attemptsOf(store, slice).map((attempt) => [attempt.taskId, attempt.check.pass]));
}

function pairOf(input: ReportInput, a: Slice, b: Slice, label?: string): Paired | null {
  const { store } = input.engine;
  const left = outcomes(store, a);
  const right = outcomes(store, b);
  const all = paired(left, right);
  const difference = pairedDifference(all);
  if (all.scenarios === 0 || difference === null) return null;
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
  return {
    a: a.arm,
    b: b.arm,
    label: label ?? `${labelOf(a)} vs ${labelOf(b)}`,
    seed: a.seed,
    ...all,
    difference,
    byType,
  };
}

/**
 * Where each arm's own locked test ran, as configuration and target; null before its test. An
 * arm whose protocol pairs its test without its adapter has both, labelled H1/A1 and H1/A0.
 */
function ownSlices(arm: ArmId, run: StoredRun, seed: number): Slice[] {
  const frozen = run.freeze;
  if (frozen === null) return [];
  const own: Slice = {
    arm,
    run,
    target: run.lockedTestOn,
    config: configurationKey(frozenConfig(frozen)),
    seed,
    configuration: null,
  };
  const without = withoutAdapterConfig(frozen);
  if (run.protocol?.pairedWithoutAdapter !== true || without === null) return [own];
  return [
    { ...own, configuration: 'H1/A1' },
    { ...own, config: configurationKey(without), configuration: 'H1/A0' },
  ];
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
  ['reference-targeted', 'targeted'],
  ['reference-targeted', 'reference'],
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
    label: labelOf(first),
    seeds: slices.map((slice, index) => {
      const map = maps[index] ?? new Map<string, boolean>();
      return {
        seed: slice.seed,
        score: { pass: [...map.values()].filter(Boolean).length, total: map.size },
      };
    }),
    everySeed: counted(every, tasks.length),
    flipped,
    complete: maps.every((map) => map.size >= lockedTestsOf(input.base, input.config)),
  };
}

/** Every backend table: rows under the first declared seed, pairs within the table, repeats apart. */
function backendTables(input: ReportInput): BackendTable[] {
  const { store } = input.engine;
  const [firstSeed = 0, ...repeatSeeds] = declared(input).testSeeds;
  const slices: Slice[] = [];
  const paired: { a: Slice; b: Slice; label: string }[] = [];
  for (const arm of ARM_ORDER) {
    if (REFERENCE_ON[arm] !== undefined || arm === 'repeat') continue;
    const run = armRun(store, arm);
    if (run === null) continue;
    const own = ownSlices(arm, run, firstSeed);
    slices.push(...own);
    const [withAdapter, without] = own;
    if (withAdapter !== undefined && without !== undefined) {
      paired.push({
        a: withAdapter,
        b: without,
        label: `${ARM_LABELS[arm]}: with its adapter (H1/A1) vs without it (H1/A0), on one llama-server`,
      });
    }
    // A re-test on this computer of a graduate whose own test was hosted.
    const [single] = own;
    if (
      own.length === 1 &&
      single !== undefined &&
      run.lockedTestOn === 'hosted' &&
      store.retests.get(run.run.id, 'local') !== null
    ) {
      slices.push({ ...single, target: 'local' });
    }
  }
  for (const [arm, on] of Object.entries(REFERENCE_ON) as [ArmId, ArmId][]) {
    const run = armRun(store, on);
    const reference = run === null ? null : store.references.get(run.run.id, 'test');
    if (run === null || reference === null) continue;
    slices.push({
      arm,
      run,
      target: run.lockedTestOn,
      config: reference.configKey,
      seed: firstSeed,
      configuration: null,
    });
  }
  const tables: BackendTable[] = [];
  for (const backend of ['hosted', 'reference', 'local-ollama', 'local-llama.cpp'] as const) {
    const inTable = slices.filter((slice) => backendOf(slice) === backend);
    const rows = inTable.flatMap((slice) => rowOf(input, slice) ?? []);
    if (rows.length === 0) continue;
    // Spark pairs with the hosted arms on the same tasks and seed: a reference, labelled so.
    const partners =
      backend === 'reference'
        ? [...inTable, ...slices.filter((slice) => backendOf(slice) === 'hosted')]
        : inTable;
    // An arm's own result: its one row, or with its adapter when it has both.
    const isOwn = (slice: Slice) => slice.configuration === null || slice.configuration === 'H1/A1';
    const pairs = [
      ...CONTRASTS.flatMap(([a, b]) => {
        const left = inTable.find((slice) => slice.arm === a && isOwn(slice));
        const right = partners.find((slice) => slice.arm === b && isOwn(slice));
        if (left === undefined || right === undefined) return [];
        return pairOf(input, left, right) ?? [];
      }),
      ...paired
        .filter(({ a }) => backendOf(a) === backend)
        .flatMap(({ a, b, label }) => pairOf(input, a, b, label) ?? []),
    ];
    const repeats = inTable.flatMap((slice) => {
      if (REFERENCE_ON[slice.arm] !== undefined) return [];
      return repeatRow(input, [slice, ...repeatSeeds.map((seed) => ({ ...slice, seed }))]) ?? [];
    });
    tables.push({
      backend,
      label: BACKEND_LABELS[backend],
      identity: input.plan?.identities[backend] ?? UNKNOWN_IDENTITY(backend),
      rows,
      paired: pairs,
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

/** Adds dollars where one unknown makes the sum unknown, never lower. */
function addKnown(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/** A run's training jobs, by the worker's records. */
function jobsOf(input: ReportInput, runId: string) {
  return input.deps.training?.worker.list().filter((job) => job.scope === runId) ?? [];
}

/** What an arm spent, each line apart, from the run's ledger, attempts and training jobs. */
function spendOf(input: ReportInput, arm: ArmId): Spend {
  const { store } = input.engine;
  const deferred = new Set(declared(input).testSeeds.slice(1));
  const isRepeat = (attempt: StoredAttempt) =>
    attempt.split === 'test' && deferred.has(attempt.seed);
  if (arm === 'repeat') {
    const lines = (['bare', 'draft', 'targeted'] as const).flatMap((source) => {
      const run = armRun(store, source);
      return run === null ? [] : [studentLines(store, run.run.id, isRepeat)];
    });
    return {
      ...NO_SPEND,
      studentUsd: addKnown(lines.map((line) => line.usd)),
      studentInputTokens: lines.reduce((sum, line) => sum + line.inputTokens, 0),
      studentOutputTokens: lines.reduce((sum, line) => sum + line.outputTokens, 0),
      studentAttempts: lines.reduce((sum, line) => sum + line.attempts, 0),
    };
  }
  const on = REFERENCE_ON[arm];
  if (on !== undefined) {
    const run = armRun(store, on);
    const record = run === null ? null : store.references.get(run.run.id, 'test');
    if (run === null || record === null) return NO_SPEND;
    const attempts = store.attempts
      .list({ runId: run.run.id, split: 'test' })
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
  const jobs = jobsOf(input, runId);
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

/** What making a run's graduate took: its Spark, its student outside the locked test, compute. */
function developmentOf(input: ReportInput, run: StoredRun) {
  const { store } = input.engine;
  const runId = run.run.id;
  return {
    sparkUsd: store.costs
      .list(runId)
      .filter((cost) => cost.role === 'mentor')
      .reduce((sum, cost) => sum + (cost.usd ?? 0), 0),
    studentUsd: studentLines(store, runId, (attempt) => attempt.split !== 'test').usd,
    computeUsd: jobsOf(input, runId).reduce((sum, job) => sum + computeSoFar(job).usd, 0),
  };
}

/** Each arm's job copy, read once for the report: what it started from, its caps. */
type JobOf = (arm: ArmId) => Job | null;

/**
 * The arms whose development an arm's graduate builds on: the shared draft the refining arms
 * start from, and the targeted arm's harness, with all it built on, that the weights arms adopt.
 */
function builtOn(input: ReportInput, arm: ArmId, jobOf: JobOf): ArmId[] {
  const { store } = input.engine;
  switch (arm) {
    case 'targeted':
    case 'fixed':
      return jobOf(arm)?.startingHarness.kind === 'import' && armRun(store, 'draft') !== null
        ? ['draft']
        : [];
    case 'weights-one-shot':
    case 'weights-targeted':
      return armRun(store, 'targeted') === null
        ? []
        : ['targeted', ...builtOn(input, 'targeted', jobOf)];
    default:
      return [];
  }
}

/**
 * A graduate's cumulative development cost: its own, and that of each arm it builds on, such as
 * the shared draft the targeted arm starts from. The experiment totals count each dollar once.
 */
function cumulativeOf(input: ReportInput, arm: ArmId, jobOf: JobOf): ArmReport['cumulative'] {
  const { store } = input.engine;
  if (REFERENCE_ON[arm] !== undefined || arm === 'repeat') return null;
  const run = armRun(store, arm);
  if (run === null) return null;
  const on = builtOn(input, arm, jobOf);
  const parts = [run, ...on.flatMap((other) => armRun(store, other) ?? [])].map((each) =>
    developmentOf(input, each),
  );
  return {
    builtOn: on,
    sparkUsd: parts.reduce((sum, part) => sum + part.sparkUsd, 0),
    studentUsd: addKnown(parts.map((part) => part.studentUsd)),
    computeUsd: parts.reduce((sum, part) => sum + part.computeUsd, 0),
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
  'nothing_to_try',
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
  const on = REFERENCE_ON[arm];
  if (on !== undefined || arm === 'repeat') {
    const sources = (on !== undefined ? [on] : ['bare', 'draft', 'targeted']) as ArmId[];
    const records = sources.flatMap((source) => {
      const run = armRun(store, source);
      if (run === null) return [];
      const record =
        on !== undefined
          ? store.references.get(run.run.id, 'test')
          : store.repeats.get(run.run.id, run.lockedTestOn);
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
      // Its locked test stayed held for money, or the person dropped it: frozen, and never tested.
      if (decision?.kind === 'held' || decision?.kind === 'dropped') {
        return { status: 'stopped', reason: decision.reason };
      }
      if (isHeld(run)) {
        if (stopped !== null) return { status: 'stopped', reason: stopped };
        return {
          status: 'incomplete',
          reason: "Its training is done, and its final test hasn't run yet.",
        };
      }
      if (stopped !== null) return { status: 'stopped', reason: stopped };
      return { status: 'incomplete', reason: run.run.error ?? `The run is ${run.run.status}.` };
  }
}

function capsOf(input: ReportInput, arm: ArmId, job: Job | null): ArmCaps {
  const student = input.plan?.studentCaps[arm] ?? null;
  if (REFERENCE_ON[arm] !== undefined) {
    return {
      sparkUsd:
        arm === 'reference'
          ? input.config.sparkCaps.reference
          : input.config.sparkCaps.referenceTargeted,
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

/**
 * The one-shot adapter's recipe, said for what it is (decision 051): its demonstrations are a
 * pilot, and a result without an effect speaks to the recipe, not to weights against harnesses.
 */
function pilotRecipe(input: ReportInput): string {
  const types = input.base.taskTypes.length;
  const perType = input.config.oneShotPerType;
  return `Its ${perType * types} verified demonstrations (${perType} of each type, chosen by seed, never from a failure) are a pilot recipe, not an established training budget for a 30B model: a result without an effect means this recipe didn't help, not that weights lose to harnesses.`;
}

/** What a weights arm's records show it trained, measured and tested, and nothing more. */
function weightsNotes(input: ReportInput, arm: ArmId, run: StoredRun | null): string[] {
  const { store } = input.engine;
  const reduced = run?.protocol?.oneShotAdapter?.smokeTasks !== undefined;
  const notes = [
    reduced
      ? `Reduced adapter protocol: it starts from the targeted arm's frozen harness (H1), trains one adapter on it, checks it on ${run?.protocol?.oneShotAdapter?.smokeTasks ?? input.config.smokeTasks} train tasks on llama-server, and takes its locked test with and without the adapter (H1/A1 against H1/A0) on that llama-server, on the same scenarios, seed and GGUF. The four-configuration dev evaluation is skipped. It measures only this adapter's added effect given the frozen targeted harness: not the harness's own effect, how the two interact, or what iterative mentoring adds.`
      : "Its H0 is the blank harness the bare arm runs; its H1 is the targeted arm's frozen harness, adopted whole in round 1 and kept whatever it scored.",
    arm === 'weights-one-shot'
      ? pilotRecipe(input)
      : 'Training rounds only: its mentor could choose no harness change, and each adapter faced the keep rule.',
  ];
  if (run === null) return notes;
  const jobs = jobsOf(input, run.run.id);
  if (jobs.length === 0) {
    notes.push('No training job ran, so it trained no adapter.');
  } else {
    for (const job of jobs) {
      const trained =
        job.state === 'ready'
          ? job.real && job.artifacts?.standIn !== true
            ? `ended with its adapter, trained on ${job.dataset.exampleCount} examples`
            : 'ended on the stand-in backend, which trains nothing'
          : `ended ${job.state}${job.error ? `: ${job.error.message}` : ''}`;
      notes.push(`Training job ${job.id} on ${job.label} ${trained}.`);
    }
  }
  const experiments = store.experiments.list(run.run.id).filter((item) => item.kind === 'weights');
  const measured = experiments.flatMap((item) =>
    item.measurements.filter((cell) => cell.configuration.adapter !== null),
  );
  if (measured.length === 0) {
    notes.push('No configuration with an adapter was measured.');
  } else {
    const smoke = measured.filter((cell) => cell.split === 'train').length;
    notes.push(
      smoke > 0
        ? `Its adapter was checked on train tasks (the smoke check), in round ${experiments.map((item) => item.round).join(', ')}, and measured on no dev task.`
        : `Its adapters were measured on dev in round ${experiments.map((item) => item.round).join(', ')}; dev picks what is kept, and only the locked test is claimed.`,
    );
  }
  const tested = store.attempts.list({ runId: run.run.id, split: 'test' }).length > 0;
  const adapter = run.freeze?.configuration?.adapter ?? null;
  notes.push(
    !tested
      ? "Its locked test hasn't run."
      : adapter !== null
        ? 'Adapters run only on this computer, so its locked test ran here, on llama-server with its adapter.'
        : 'It kept no adapter, so its locked test ran on this computer on Ollama, as a graduate without one runs.',
  );
  return notes;
}

function notesOf(input: ReportInput, arm: ArmId, run: StoredRun | null, job: Job | null): string[] {
  const { store } = input.engine;
  const notes: string[] = [];
  const draft = armRun(store, 'draft');
  switch (arm) {
    case 'bare':
      notes.push(
        'The student on the blank starting harness, with no mentoring: the baseline the other arms are compared with.',
      );
      break;
    case 'draft': {
      notes.push(
        'Spark wrote the whole harness once, from the job alone, without seeing the student attempt anything. It is kept whatever it scores.',
      );
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
      notes.push(
        "Each round Spark reads the student's failed attempts on practice tasks and makes one change to the harness; a change is kept only if it clears the keep rule on dev.",
      );
      if (job?.startingHarness.kind === 'import' && draft !== null) {
        notes.push(
          `It starts from the draft arm's kept harness (version ${draft.freeze?.harnessVersion ?? '?'}), so the draft's Spark spend came off this arm's cap, and its cumulative cost below includes the draft's development.`,
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
      notes.push(...weightsNotes(input, arm, run));
      break;
    case 'reference':
      notes.push(
        "The primary reference: Spark acted as the agent with the bare arm's frozen harness (blank), so it saw no lesson, with the same tools and limits, on the same locked-test tasks under the first seed. It is a reference, not an arm: nothing it did reached mentoring, and the same checker graded it.",
      );
      break;
    case 'reference-targeted':
      notes.push(
        "A second reference, declared in the plan before anything ran: Spark acted as the agent with the targeted arm's frozen harness, for a same-harness comparison with the targeted graduate, with the same tools, limits, tasks and seed. The blank-harness reference stays the primary one. Nothing it did reached mentoring.",
      );
      break;
    case 'repeat':
      notes.push(
        `The frozen bare, draft and targeted graduates took the locked test again under seed ${declared(input).testSeeds.slice(1).join(' and ')}, declared before any run. Repeats are reported as repeats, never as more scenarios.`,
      );
      break;
    default:
      break;
  }
  return notes;
}

/** Why training ended, in a few words, by the run's stop reason. */
const TRAINING_ENDED_SHORT: Record<RunStopReason | 'complete', string> = {
  complete: 'done',
  target_met: 'done, the dev target was reached',
  rounds: 'cap reached',
  patience: 'patience ran out',
  usd: 'money ran out',
  wall_clock: 'time ran out',
  rejected: 'replies it could not use',
  leak: 'stopped by the leak check',
  user: 'stopped',
  error: 'stopped by an error',
  contract: 'the job contract changed',
  nothing_to_try: 'the mentor had nothing it may change',
};

/** Statuses of a run whose training is over, successfully or not. */
const TRAINING_OVER: ReadonlySet<RunStatus> = new Set(['testing', 'finished', 'stopped', 'failed']);

/**
 * The rounds a run used and why its training ended, from its totals and stop reason; null for an
 * arm with no rounds (the bare student, and the arms that measure other arms' runs).
 */
export function roundsOf(run: StoredRun | null, caps: ArmCaps): ArmReport['rounds'] {
  if (run === null || caps.rounds === null) return null;
  const { status, stopReason } = run.run;
  const reason =
    status === 'failed' ? 'error' : (stopReason ?? (status === 'stopped' ? 'user' : 'complete'));
  return {
    used: run.run.totals.rounds,
    ended: TRAINING_OVER.has(status) ? TRAINING_ENDED_SHORT[reason] : null,
  };
}

function armReport(input: ReportInput, arm: ArmId, jobOf: JobOf): ArmReport {
  const { store } = input.engine;
  const measuring = REFERENCE_ON[arm] !== undefined || arm === 'repeat';
  const run = measuring ? null : armRun(store, arm);
  const job = jobOf(arm);
  const { status, reason } = statusOf(input, arm);
  const frozen = run?.freeze ?? null;
  const adapter = frozen?.configuration?.adapter ?? null;
  const caps = capsOf(input, arm, job);
  const experiments =
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
        }));
  const kept = experiments.filter((experiment) => experiment.disposition === 'kept').at(-1);
  return {
    arm,
    label: ARM_LABELS[arm],
    priority: ARM_PRIORITY[arm],
    status,
    reason,
    runId: run?.run.id ?? null,
    notes: notesOf(input, arm, run, job),
    caps,
    spent: spendOf(input, arm),
    cumulative: cumulativeOf(input, arm, jobOf),
    dev: {
      baseline: run?.run.devBaseline ?? null,
      kept:
        kept === undefined
          ? null
          : { round: kept.round, kind: kept.kind, before: kept.devBefore, after: kept.devAfter },
    },
    rounds: roundsOf(run, caps),
    measuredOn: [],
    experiments,
    frozen:
      frozen === null
        ? null
        : {
            harnessVersion: frozen.harnessVersion,
            harnessHash: frozen.harnessHash,
            localModel: frozen.student.model,
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
          split: measurement.split ?? ('dev' as const),
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

/**
 * Whether an adapter a real job trained took the locked test, by the records: a row on
 * llama-server with its adapter applied, from a graduate whose adapter isn't a stand-in's.
 */
function adapterTested(arms: readonly ArmReport[], backends: readonly BackendTable[]): boolean {
  const llama = backends.find((table) => table.backend === 'local-llama.cpp');
  return (
    llama?.rows.some(
      (row) =>
        row.adapterSha256 !== null &&
        arms.some((arm) => arm.arm === row.arm && arm.frozen?.adapter?.standIn === false),
    ) ?? false
  );
}

/**
 * Which seeds the locked test ran under: the mentoring seed, the one the arms' tables are under,
 * and each seed declared for the repeat, said as it ran or as it didn't.
 */
function seedsDisclosure(plan: ComparisonReport['plan']): string {
  const ran = (seed: number) =>
    (plan.seedResults.find((item) => item.seed === seed)?.arms.length ?? 0) > 0;
  const [first, ...repeats] = plan.testSeeds;
  const sentences = [`Every arm ran with one mentoring seed (${plan.mentoringSeed}).`];
  if (first !== undefined) {
    sentences.push(
      ran(first) ? `The locked test ran under seed ${first}.` : 'No locked test has run.',
    );
  }
  for (const seed of repeats) {
    sentences.push(
      ran(seed)
        ? `Seed ${seed} is a decoding repeat, never more scenarios.`
        : `Seed ${seed} was declared for a decoding repeat that was not run, so no result here is under it.`,
    );
  }
  return sentences.join(' ');
}

/**
 * For a job with organizations: what the locked test holds, how the target is judged, and the
 * study every arm shared. Nothing for a one-organization job.
 */
function fieldDisclosures(input: ReportInput): string[] {
  const { organizations } = input.field;
  const sealed = organizations.filter((org) => org.role === 'transfer');
  if (organizations.length === 0) return [];
  const lines: string[] = [];
  if (sealed.length > 0) {
    const named = sealed
      .map((org) => `${org.name} (${org.synthetic ? 'synthetic' : 'real'})`)
      .join(', ');
    lines.push(
      `Each locked test holds ${lockedTestsOf(input.base, input.config)} tasks: the test split of the organizations the arms trained on (${input.base.splits.test}), and every task of the organizations no arm ever saw: ${named}. The target is judged on the trained organizations alone; each organization never seen is reported on its own, by skill, and never averaged in.`,
    );
  }
  if (input.study !== null) {
    lines.push(
      `Spark studied the trained organizations' files once for the whole comparison (${money(input.study.cost.usd)}, ${input.study.cost.calls} call${input.study.cost.calls === 1 ? '' : 's'}${input.study.confirmedAt === undefined ? '' : `, confirmed ${input.study.confirmedAt}`}); every arm started from that same brief, the bare arm without its procedure. The totals count it once.`,
    );
  }
  return lines;
}

/** What a reader needs before trusting a number, made from the same records as the tables. */
function disclosures(
  input: ReportInput,
  arms: readonly ArmReport[],
  backends: readonly BackendTable[],
  adapters: readonly AdapterCell[],
  plan: ComparisonReport['plan'],
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
  lines.push(seedsDisclosure(plan));
  for (const amendment of plan.amendments) {
    lines.push(
      `Before any locked test was released, the hosted student's cap was raised from $${amendment.fromUsd.toFixed(2)} to $${amendment.toUsd.toFixed(2)} (${amendment.at}), when an attempt had cost $${amendment.priceUsd.toFixed(4)}${amendment.arm === null ? '' : `, to pay for ${ARM_LABELS[amendment.arm].toLowerCase()}`}${amendment.armToUsd === null ? '' : `, whose own cap went from $${(amendment.armFromUsd ?? 0).toFixed(2)} to $${amendment.armToUsd.toFixed(2)}`}.`,
    );
  }
  lines.push(...fieldDisclosures(input));
  if (backends.some((table) => table.paired.length > 0)) {
    lines.push(
      "A pair's difference in pass rate is the first arm's less the second's, with a 95% interval for paired proportions: Newcombe's hybrid score method, his method 10 (Statistics in Medicine, 1998), made from the wins, losses, both and neither counts. When the interval includes zero, no difference was shown, which is not the same as showing there is none.",
    );
  }
  const target = passTargetOf(input, 0, 0);
  const interval = wilson(target.needed, target.of);
  lines.push(
    `Targets are quoted as observed counts: ${target.needed} of ${target.of} meets the job's ${percent(target.passRate)} target as observed. That is not proof of ${percent(target.passRate)} reliability: ${target.needed} of ${target.of} has a 95% Wilson interval of ${percent(interval?.low ?? null)} to ${percent(interval?.high ?? null)}.`,
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
  const built = arms.filter((arm) => (arm.cumulative?.builtOn.length ?? 0) > 0);
  if (built.length > 0) {
    lines.push(
      `The totals count each dollar once. A graduate's cumulative cost adds what it builds on: ${built.map((arm) => `${arm.label} includes the ${(arm.cumulative?.builtOn ?? []).map((other) => ARM_LABELS[other].toLowerCase()).join(' and ')} arm's development (Spark ${money(arm.cumulative?.sparkUsd ?? null)}, student ${money(arm.cumulative?.studentUsd ?? null)}, compute ${money(arm.cumulative?.computeUsd ?? null)} in all)`).join('; ')}.`,
    );
  }
  if (arms.some((arm) => !arm.spent.computeSettled)) {
    lines.push(
      "Some compute is a training job's whole authorization: the job had not ended when this report was made, so its cost may be lower.",
    );
  }
  if (input.credit !== null && input.credit.requests > 0) {
    lines.push(
      'The request journal writes down every hosted request before it is sent, so it also holds requests that no recorded attempt keeps the cost of (an attempt that failed or was cut off and was made again), and it counts a request a crash or a failure cut off at the most it could have cost, since its charge is not known. A restart repeats no recorded attempt, Spark reply or training job; an attempt in flight when a process stopped is made again, and its cut-off requests count in the journal at their worst; a Spark call in flight is paid again.',
    );
  }
  const billing = input.plan?.billing ?? billingOf(input.calibration);
  if (billing !== null) {
    lines.push(
      billing.billedCalls === 0
        ? "The provider reported no charges during calibration, so the student's costs are at the listed price."
        : `Calibration against the provider's billing: it billed ${money(billing.billedUsd)} where the listed price of the same usage is ${money(billing.listedUsd)}${billing.ratio === null ? '' : ` (${billing.ratio.toFixed(3)} times)`}, for ${billing.billedCalls} of ${billing.calls} calls. Costs are what it billed wherever it said.`,
    );
  }
  if (!adapterTested(arms, backends)) {
    lines.push(
      `Harness-only graduate. Remote QLoRA training and adapter loading are built; real end-to-end training is not validated. ${declared(input).realCompute ? 'A01 is not met: no adapter a real training job made took the locked test.' : 'A01 is not met: this comparison ran no training job.'}`,
    );
  } else {
    lines.push(
      "Adapters trained against NF4 weights loaded from the bf16 checkpoint and were measured only on this computer's 2-bit build; no bf16 evaluation of an adapter exists, so a gain's transfer from bf16 is not stated.",
    );
  }
  if (arms.some((arm) => arm.arm === 'weights-one-shot' && arm.status !== 'not_run')) {
    lines.push(`The one-shot adapter's recipe is a pilot. ${pilotRecipe(input)}`);
  }
  if (adapters.length > 0) {
    lines.push(
      'The adapter configurations table is development only: dev measurements the keep rule picked from, and smoke checks on train tasks. Only the locked-test tables carry results.',
    );
  }
  // The build each frozen agent is set to run on once installed: named, never measured unless a
  // locked test ran on this computer.
  const build = arms.find((arm) => arm.frozen !== null)?.frozen?.localModel;
  if (
    !backends.some(
      (table) => table.backend === 'local-ollama' || table.backend === 'local-llama.cpp',
    )
  ) {
    lines.push(
      `Local evaluation incomplete: no locked test ran on this computer, so no result here describes ${build === undefined ? 'the build the agents are set to run on' : `${build}, the build the agents are set to run on`}.`,
    );
  }
  const hosted = backends.find((table) => table.backend === 'hosted');
  if (hosted !== undefined) {
    lines.push(
      `Hosted results ran on ${hosted.identity.provider ?? 'the hosted copy'} (${hosted.identity.quantization ?? 'precision not reported'}); this computer runs ${build ?? 'another build'}, so hosted and local tables are never compared row to row.`,
    );
  }
  if (
    backends.some(
      (table) =>
        table.rows.some((row) => !row.complete) || table.repeats.some((row) => !row.complete),
    )
  ) {
    lines.push(
      'A row or repeat marked partial ran fewer scenarios than the locked test holds; its counts cover only what ran, and it meets no target.',
    );
  }
  if (arms.some((arm) => REFERENCE_ON[arm.arm] !== undefined && arm.status !== 'not_run')) {
    const second = arms.some((arm) => arm.arm === 'reference-targeted' && arm.status !== 'not_run');
    lines.push(
      `Spark's rows are references on the same tasks, tools, limits and seed, not arms, graded by the same checker; Spark judged nothing. The blank-harness row is the primary reference: Spark saw no lesson.${second ? " The targeted-harness row, declared before anything ran, gives Spark the targeted arm's frozen harness for a same-harness comparison." : ''}`,
    );
  }
  const regression = input.regression;
  if (regression !== null) {
    lines.push(
      `The runtime regression check ran only the bare student, on ${regression.attempts.length} dev tasks of ${regression.job.name}: it checks the runtime on a second job. It is not evidence that mentoring caused no regression there, since no mentored graduate was tested on that job.`,
    );
  }
  return lines;
}

/**
 * Every dollar the attempts and the ledger record as spent, once: each arm's own lines and the
 * sweeps', the student's in its three parts.
 */
function totalsOf(input: ReportInput, arms: readonly ArmReport[]): ComparisonReport['totals'] {
  const studentParts = {
    armsUsd: addKnown(arms.map((arm) => arm.spent.studentUsd)),
    calibrationUsd: addKnown(input.calibration.map((attempt) => attempt.usd)),
    regressionUsd: addKnown((input.regression?.attempts ?? []).map((attempt) => attempt.usd)),
  };
  return {
    // Spark's study of the organizations is shared by every arm, so it is counted here once.
    sparkUsd: arms.reduce((sum, arm) => sum + arm.spent.sparkUsd, 0) + (input.study?.cost.usd ?? 0),
    studentUsd: addKnown(Object.values(studentParts)),
    studentParts,
    computeUsd: arms.reduce((sum, arm) => sum + arm.spent.computeUsd, 0),
    computeSettled: arms.every((arm) => arm.spent.computeSettled),
  };
}

/**
 * Each declared locked-test seed, then any other one a locked test ran under, with the arms that
 * have a stored result under it. The first seed is every arm's; the rest are the repeat's.
 */
function seedResultsOf(input: ReportInput): ComparisonReport['plan']['seedResults'] {
  const { store } = input.engine;
  const found = new Map<number, Set<ArmId>>();
  for (const arm of ARM_ORDER) {
    if (arm === 'repeat') continue;
    const on = REFERENCE_ON[arm];
    const run = armRun(store, on ?? arm);
    if (run === null) continue;
    // A Spark reference's results are the attempts filed under its configuration; every other
    // arm's, the student's own.
    const reference = on === undefined ? null : store.references.get(run.run.id, 'test');
    if (on !== undefined && reference === null) continue;
    for (const attempt of store.attempts.list({ runId: run.run.id, split: 'test' })) {
      const mine =
        reference === null
          ? attempt.config?.startsWith('reference/') !== true
          : attempt.config === reference.configKey;
      if (mine) found.set(attempt.seed, (found.get(attempt.seed) ?? new Set<ArmId>()).add(arm));
    }
  }
  const { testSeeds } = declared(input);
  const others = [...found.keys()]
    .filter((seed) => !testSeeds.includes(seed))
    .sort((a, b) => a - b);
  return [...testSeeds, ...others].map((seed) => ({
    seed,
    arms: ARM_ORDER.filter((arm) => found.get(seed)?.has(arm) === true),
  }));
}

/** The arms with the backends they have a locked-test row in. */
function withMeasuredOn(
  arms: readonly ArmReport[],
  backends: readonly BackendTable[],
): ArmReport[] {
  return arms.map((arm) => ({
    ...arm,
    measuredOn: backends
      .filter((table) => table.rows.some((row) => row.arm === arm.arm))
      .map((table) => table.backend),
  }));
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
  const jobsByArm = new Map<ArmId, Job>();
  for (const arm of ARM_ORDER) {
    const run = REFERENCE_ON[arm] !== undefined || arm === 'repeat' ? null : armRun(store, arm);
    if (run !== null) jobsByArm.set(arm, await jobs.forRun(run));
  }
  const jobOf: JobOf = (arm) => jobsByArm.get(arm) ?? null;
  const backends = backendTables(input);
  const arms = withMeasuredOn(
    ARM_ORDER.filter(
      (arm) => input.plan?.arms.includes(arm) ?? input.config.arms.includes(arm),
    ).map((arm) => armReport(input, arm, jobOf)),
    backends,
  );
  const adapters = adapterCells(input);
  const totals = totalsOf(input, arms);
  const settings = declared(input);
  const plan: ComparisonReport['plan'] = {
    mentoringSeed: settings.mentoringSeed,
    testSeeds: [...settings.testSeeds],
    seedResults: seedResultsOf(input),
    order: [...ARM_ORDER],
    adapterProtocol: settings.adapterProtocol,
    releasedAt: input.plan?.releasedAt ?? null,
    funding: input.plan?.funding ?? null,
    amendments: input.plan?.amendments ?? [],
  };
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
    plan,
    inputs: input.plan?.inputs ?? null,
    calibration: sweepSummary('Calibration', input.base, input.calibration, 'hosted'),
    billing: input.plan?.billing ?? billingOf(input.calibration),
    regression:
      input.regression === null
        ? null
        : sweepSummary(
            'Runtime regression check',
            input.regression.job,
            input.regression.attempts,
            'hosted',
          ),
    credit:
      input.credit === null
        ? null
        : { ...input.credit, totalUsd: input.credit.settledUsd + input.credit.uncertainUsd },
    totals,
    projection: input.plan?.projection ?? null,
    arms,
    backends,
    adapters,
    disclosures: disclosures(input, arms, backends, adapters, plan),
  };
  // The records keep their words as they were; the report says them in plain text.
  return ComparisonReportSchema.parse(plainStrings(report));
}
