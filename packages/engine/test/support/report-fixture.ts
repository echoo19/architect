import {
  COMPARISON_REPORT_FORMAT,
  ComparisonReportSchema,
  type ArmId,
  type ArmReport,
  type ArmRow,
  type BackendTable,
  type ComparisonReport,
  type Decoding,
  type Paired,
  type PinnedInputs,
  type RuntimeIdentity,
  type Spend,
  type TaskSweep,
} from '@architect/shared';
import { ARM_ORDER } from '../../src/comparisons';
import { counted, pairedDifference } from '../../src/comparisons/stats';

/*
 * A comparisons report shaped like the first real one: the bare student, a one-shot draft, targeted
 * mentoring and Spark as a reference, all on the hosted copy under seed 101, with seed 102
 * declared and not run. Tests change what they need and render it.
 */

/** What the bare arm's blank harness sets. */
export const BLANK: Decoding = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxSteps: 16,
  maxOutputTokens: 4096,
  thinking: 'low',
};

/** What the drafted harness sets, which the targeted arm started from. */
export const DRAFTED: Decoding = {
  temperature: 0,
  topP: 1,
  topK: 64,
  maxSteps: 30,
  maxOutputTokens: 8192,
  thinking: 'high',
};

export const LOCAL_MODEL = 'muse-glimmer:30b-iq2';

export function spend(changes: Partial<Spend> = {}): Spend {
  return {
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
    ...changes,
  };
}

/** An arm's report with nothing run: tests give it what they look at. */
export function arm(id: ArmId, label: string, changes: Partial<ArmReport> = {}): ArmReport {
  return {
    arm: id,
    label,
    priority: 1,
    status: 'complete',
    reason: null,
    runId: `run_${id}`,
    notes: [],
    caps: { sparkUsd: 0, studentUsd: 1, computeUsd: null, wallMinutes: 720, rounds: null },
    spent: spend(),
    cumulative: null,
    dev: { baseline: null, kept: null },
    rounds: null,
    measuredOn: ['hosted'],
    experiments: [],
    frozen: {
      harnessVersion: 1,
      harnessHash: `sha256-${id.padEnd(12, '0').replace(/[^0-9a-f]/g, '0')}${'0'.repeat(52)}`,
      localModel: LOCAL_MODEL,
      backend: 'ollama',
      adapter: null,
      testSeeds: [101, 102],
      decoding: BLANK,
    },
    ...changes,
  };
}

/** One arm's locked-test row under seed 101, out of 60 scenarios. */
export function row(id: ArmId, label: string, pass: number, sampling: Decoding): ArmRow {
  return {
    arm: id,
    label,
    runId: `run_${id}`,
    configuration: null,
    seed: 101,
    scenarios: counted(pass, 60),
    passTarget: { passRate: 0.95, needed: 57, of: 60, met: pass >= 57 },
    perType: [{ type: 'refund', label: 'Refunds', ...counted(Math.floor(pass / 3), 20) }],
    refusals: 0,
    latencyMs: { p50: 17_700, p95: 70_500 },
    coldStartMs: null,
    peakMemory: null,
    harnessHash: `sha256-${id.padEnd(12, '0').replace(/[^0-9a-f]/g, '0')}${'0'.repeat(52)}`,
    adapterSha256: null,
    sampling,
    complete: true,
    model: null,
    runsOn: null,
    perThousandUsd: null,
  };
}

/** Two arms paired scenario by scenario under seed 101. */
export function pair(
  a: ArmId,
  b: ArmId,
  label: string,
  counts: { wins: number; losses: number; both: number; neither: number },
): Paired {
  const { wins: aOnly, losses: bOnly, both, neither } = counts;
  const difference = pairedDifference({ aOnly, bOnly, both, neither });
  if (difference === null) throw new Error('A pair needs a scenario.');
  return {
    a,
    b,
    label,
    seed: 101,
    scenarios: aOnly + bOnly + both + neither,
    aOnly,
    bOnly,
    both,
    neither,
    difference,
    byType: [],
  };
}

export function identity(changes: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  return {
    model: 'meta/muse-glimmer-30b',
    provider: 'openrouter.ai, pinned to DeepInfra with no fallback',
    runtime: 'openai_compatible',
    quantization: 'bf16',
    ggufSha256: null,
    runtimeBuild: null,
    chatTemplate: "the provider's own",
    contextLength: 16_384,
    ...changes,
  };
}

/** A job folder as the plan pinned it: each hash starts with `lead` and is 64 hex digits long. */
function pinned(jobId: string, name: string, lead: string): PinnedInputs {
  const hash = (digit: string) => `${lead}${digit.repeat(62)}`;
  return { jobId, name, job: hash('1'), tasks: hash('2'), data: hash('3'), checker: hash('4') };
}

/** The bare student on tasks outside any arm. */
function sweep(label: string, job: string, tasks: number, pass: number): TaskSweep {
  return {
    label,
    job,
    tasks,
    backend: 'hosted',
    scenarios: counted(pass, tasks),
    perType: [{ type: 'refund', label: 'Refunds', ...counted(pass, tasks) }],
    latencyMs: { p50: 31_700, p95: 59_300 },
    meanUsdPerAttempt: 0.0062,
    meanInputTokens: 61_816,
    meanOutputTokens: 1_581,
  };
}

/** The report of a comparison that ran bare, draft, targeted and Spark's reference, seed 101 only. */
export function comparisonOne(): ComparisonReport {
  const bare = arm('bare', 'Glimmer alone', {
    dev: { baseline: { pass: 24, total: 45 }, kept: null },
    spent: spend({ studentUsd: 0.85, studentAttempts: 105 }),
  });
  const draft = arm('draft', 'One-shot draft', {
    priority: 2,
    caps: { sparkUsd: 1, studentUsd: 1.4, computeUsd: null, wallMinutes: 720, rounds: 1 },
    dev: {
      baseline: { pass: 30, total: 45 },
      kept: {
        round: 1,
        kind: 'draft',
        before: { pass: 30, total: 45 },
        after: { pass: 35, total: 45 },
      },
    },
    rounds: { used: 1, ended: 'done' },
    experiments: [
      {
        round: 1,
        kind: 'draft',
        title: 'Larchwood exact refund pickup order harness',
        disposition: 'kept',
        devBefore: { pass: 30, total: 45 },
        devAfter: { pass: 35, total: 45 },
        regressions: [],
        reason:
          'Dev 30/45 to 35/45; the one-shot method keeps its harness without a keep-or-revert check',
      },
    ],
    frozen: {
      harnessVersion: 2,
      harnessHash: `sha256-a18de4a72c2c${'0'.repeat(52)}`,
      localModel: LOCAL_MODEL,
      backend: 'ollama',
      adapter: null,
      testSeeds: [101, 102],
      decoding: DRAFTED,
    },
  });
  const targeted = arm('targeted', 'Targeted mentoring', {
    priority: 3,
    caps: { sparkUsd: 4.88, studentUsd: 4.57, computeUsd: null, wallMinutes: 720, rounds: 2 },
    dev: {
      baseline: { pass: 33, total: 45 },
      kept: {
        round: 2,
        kind: 'harness',
        before: { pass: 60, total: 90 },
        after: { pass: 73, total: 90 },
      },
    },
    rounds: { used: 2, ended: 'cap reached' },
    experiments: [
      {
        round: 1,
        kind: 'harness',
        title: 'Fix pickup_next to parse legacy pickup_from dates',
        disposition: 'reverted',
        devBefore: { pass: 67, total: 90 },
        devAfter: { pass: 68, total: 90 },
        regressions: [{ type: 'order', before: 24, after: 23 }],
        reason:
          'Dev 32/45 to 35/45, measured again on new seeds: 67/90 to 68/90 over 2 runs, short of the +4 margin',
      },
      {
        round: 2,
        kind: 'harness',
        title: 'Normalize legacy dates in pickup tool',
        disposition: 'kept',
        devBefore: { pass: 60, total: 90 },
        devAfter: { pass: 73, total: 90 },
        regressions: [],
        reason:
          'Dev 30/45 to 39/45, measured again on new seeds: 60/90 to 73/90 over 2 runs, no type lost more than two',
      },
    ],
    frozen: {
      harnessVersion: 3,
      harnessHash: `sha256-c0fa47e2912c${'0'.repeat(52)}`,
      localModel: LOCAL_MODEL,
      backend: 'ollama',
      adapter: null,
      testSeeds: [101, 102],
      decoding: DRAFTED,
    },
  });
  const reference = arm('reference', 'Spark reference, blank harness', {
    priority: 4,
    caps: { sparkUsd: 4, studentUsd: null, computeUsd: null, wallMinutes: null, rounds: null },
    spent: spend({ sparkUsd: 2.3 }),
    measuredOn: ['reference'],
    frozen: null,
  });
  const hosted: BackendTable = {
    backend: 'hosted',
    label: 'Hosted Glimmer',
    identity: identity(),
    rows: [
      row('bare', 'Glimmer alone', 43, BLANK),
      row('draft', 'One-shot draft', 47, DRAFTED),
      row('targeted', 'Targeted mentoring', 45, DRAFTED),
    ],
    paired: [
      pair('draft', 'bare', 'One-shot draft vs Glimmer alone', {
        wins: 13,
        losses: 9,
        both: 34,
        neither: 4,
      }),
      pair('targeted', 'bare', 'Targeted mentoring vs Glimmer alone', {
        wins: 11,
        losses: 9,
        both: 34,
        neither: 6,
      }),
      pair('targeted', 'draft', 'Targeted mentoring vs One-shot draft', {
        wins: 3,
        losses: 5,
        both: 42,
        neither: 10,
      }),
    ],
    repeats: [],
  };
  const spark: BackendTable = {
    backend: 'reference',
    label: 'Spark as a reference',
    identity: identity({
      model: 'muse-spark-1.3',
      provider: 'api.meta.ai',
      runtime: 'meta',
      quantization: null,
      contextLength: null,
    }),
    rows: [row('reference', 'Spark reference, blank harness', 60, BLANK)],
    paired: [
      pair('reference', 'bare', 'Spark reference, blank harness vs Glimmer alone', {
        wins: 17,
        losses: 0,
        both: 43,
        neither: 0,
      }),
    ],
    repeats: [],
  };
  const report: ComparisonReport = {
    format: COMPARISON_REPORT_FORMAT,
    generatedAt: '2026-10-28T22:41:26.288Z',
    dryRun: false,
    commit: '6b2e69c',
    job: {
      id: 'sample-gear-returns',
      name: 'Returns desk',
      splitsSeed: 20261124,
      counts: { calibration: 15, train: 60, dev: 45, test: 60 },
    },
    plan: {
      mentoringSeed: 1,
      testSeeds: [101, 102],
      seedResults: [
        { seed: 101, arms: ['bare', 'draft', 'targeted', 'reference'] },
        { seed: 102, arms: [] },
      ],
      order: [...ARM_ORDER],
      adapterProtocol: 'four-cell',
      releasedAt: '2026-10-28T21:56:26.858Z',
      funding: null,
      amendments: [],
    },
    inputs: {
      job: pinned('sample-gear-returns', 'Returns desk', '9c'),
      regression: pinned('sample-home-services', 'Service desk', 'a2'),
    },
    calibration: sweep('Calibration', 'Returns desk', 15, 11),
    billing: null,
    regression: sweep('Runtime regression check', 'Service desk', 30, 24),
    credit: {
      capUsd: 15,
      requests: 5087,
      settledUsd: 3.80752514,
      billedRequests: 5077,
      uncertainUsd: 0.1359012,
      uncertainRequests: 10,
      inFlightRequests: 0,
      totalUsd: 3.94342634,
    },
    totals: {
      sparkUsd: 2.5796983499999975,
      studentUsd: 3.7629778799999967,
      studentParts: {
        armsUsd: 3.3437878,
        calibrationUsd: 0.09350848,
        regressionUsd: 0.3256816,
      },
      computeUsd: 0,
      computeSettled: true,
    },
    projection: null,
    arms: [bare, draft, targeted, reference],
    backends: [hosted, spark],
    adapters: [],
    disclosures: [],
  };
  return ComparisonReportSchema.parse(report);
}
