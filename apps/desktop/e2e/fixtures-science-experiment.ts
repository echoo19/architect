import { counted, pairedDifference } from '@architect/engine/testing';
import {
  ComparisonReportSchema,
  type ArmId,
  type ArmReport,
  type ArmRow,
  type ComparisonReport,
  type OrgTypeResult,
  type Paired,
} from '@architect/shared';
import { LAB_EXPERIMENTS } from './fixtures-lab';
import { SWEEP, SWEEP_DESK_JOB } from './fixtures-science';

/*
 * The finished experiment on Sweep desk, as the stand-in engine releases it: Glimmer alone, a
 * one-shot draft and targeted mentoring, each given the same 84 final-test tasks on hosted
 * Glimmer, 36 at the three groups taught on and 48 at Fennick Research, which none of them saw.
 * Every count is made from one pass or fail per task, so each arm's skills, groups and pairs add
 * up; the targeted arm scores what Sweep desk's best candidate does. The spend, the projection
 * and each arm's settings come from the recorded comparison. Stand-in numbers, as every capture's.
 */

const ARMS = ['bare', 'draft', 'targeted'] as const satisfies readonly ArmId[];
type Arm = (typeof ARMS)[number];

const GROUPS = [
  { org: 'halden', orgName: 'Halden Lab', seen: true },
  { org: 'quill', orgName: 'Quill Systems Group', seen: true },
  { org: 'marlow', orgName: 'Marlow Learning Group', seen: true },
  { org: 'fennick', orgName: 'Fennick Research', seen: false },
] as const;

/** Passes of each skill at each group, in the job's order of skills. */
const PASSES: Record<Arm, Record<(typeof GROUPS)[number]['org'], readonly number[]>> = {
  bare: {
    halden: [2, 1, 1, 0, 1, 2],
    quill: [1, 1, 2, 1, 1, 1],
    marlow: [2, 1, 1, 1, 1, 2],
    fennick: [6, 4, 5, 3, 4, 5],
  },
  draft: {
    halden: [2, 2, 1, 1, 1, 2],
    quill: [2, 1, 2, 1, 2, 1],
    marlow: [2, 2, 2, 1, 1, 2],
    fennick: [6, 5, 6, 4, 5, 5],
  },
  targeted: {
    halden: [2, 2, 2, 1, 2, 2],
    quill: [2, 1, 2, 2, 2, 2],
    marlow: [2, 2, 2, 2, 1, 2],
    fennick: [7, 6, 7, 5, 6, 6],
  },
};

interface Scenario {
  type: string;
  label: string;
  org: (typeof GROUPS)[number];
  index: number;
  total: number;
}

const skills = SWEEP_DESK_JOB.taskTypes;

const SCENARIOS: Scenario[] = skills.flatMap((skill) =>
  GROUPS.flatMap((org) => {
    const total = org.seen ? 2 : 8;
    return Array.from({ length: total }, (_, index) => ({
      type: skill.id,
      label: skill.label,
      org,
      index,
      total,
    }));
  }),
);

/**
 * Whether an arm passed a task. The mentored arms pass a cell's first tasks and Glimmer alone
 * those one further on, so the pairs hold a few losses beside the wins, as real attempts do.
 */
function passed(arm: Arm, scenario: Scenario): boolean {
  const skill = skills.findIndex((item) => item.id === scenario.type);
  const pass = PASSES[arm][scenario.org.org][skill] ?? 0;
  const offset = arm === 'bare' && pass < scenario.total ? 1 : 0;
  return scenario.index >= offset && scenario.index < pass + offset;
}

const TAUGHT_TEST = SCENARIOS.filter((scenario) => scenario.org.seen).length;
const NEEDED = Math.ceil(0.9 * TAUGHT_TEST - 1e-9);

function row(base: ArmRow, arm: Arm): ArmRow {
  const results = SCENARIOS.map((scenario) => ({ scenario, pass: passed(arm, scenario) }));
  const passes = (list: typeof results) => list.filter((item) => item.pass).length;
  const taught = passes(results.filter((item) => item.scenario.org.seen));
  const perOrg: OrgTypeResult[] = skills.flatMap((skill) =>
    GROUPS.map((org) => {
      const here = results.filter(
        (item) => item.scenario.type === skill.id && item.scenario.org.org === org.org,
      );
      return {
        type: skill.id,
        label: skill.label,
        org: org.org,
        orgName: org.orgName,
        seen: org.seen,
        synthetic: true,
        pass: passes(here),
        total: here.length,
      };
    }),
  );
  return {
    ...base,
    runId: `run_sweep_${arm}`,
    scenarios: counted(passes(results), results.length),
    passTarget: { passRate: 0.9, needed: NEEDED, of: TAUGHT_TEST, met: taught >= NEEDED },
    perType: skills.map((skill) => {
      const here = results.filter((item) => item.scenario.type === skill.id);
      return { ...counted(passes(here), here.length), type: skill.id, label: skill.label };
    }),
    perOrg,
    complete: true,
  };
}

function pair(a: Arm, b: Arm, label: string): Paired {
  const count = (scenarios: readonly Scenario[]) => {
    const counts = { aOnly: 0, bOnly: 0, both: 0, neither: 0 };
    for (const scenario of scenarios) {
      const [first, second] = [passed(a, scenario), passed(b, scenario)];
      if (first && second) counts.both += 1;
      else if (first) counts.aOnly += 1;
      else if (second) counts.bOnly += 1;
      else counts.neither += 1;
    }
    return counts;
  };
  const counts = count(SCENARIOS);
  const difference = pairedDifference(counts);
  if (!difference) throw new Error('Every pair has tasks.');
  return {
    a,
    b,
    label,
    seed: 101,
    scenarios: SCENARIOS.length,
    ...counts,
    difference,
    byType: skills.map((skill) => ({
      type: skill.id,
      ...count(SCENARIOS.filter((scenario) => scenario.type === skill.id)),
    })),
  };
}

/** What Spark cost each arm: nothing alone, one draft, and the targeted arm's four rounds. */
const SPARK_USD: Record<Arm, number> = { bare: 0, draft: 0.16, targeted: 0.84 };

/** What each arm's development did on Sweep desk's 36 check tasks, kept changes measured twice. */
const DEVELOPMENT: Record<Arm, Pick<ArmReport, 'dev' | 'rounds' | 'experiments'>> = {
  bare: { dev: { baseline: { pass: 19, total: 36 }, kept: null }, rounds: null, experiments: [] },
  draft: {
    dev: {
      baseline: { pass: 19, total: 36 },
      kept: {
        round: 1,
        kind: 'draft',
        before: { pass: 19, total: 36 },
        after: { pass: 25, total: 36 },
      },
    },
    rounds: { used: 1, ended: 'done' },
    experiments: [
      {
        round: 1,
        kind: 'draft',
        title: 'Draft Sweep desk',
        disposition: 'kept',
        devBefore: { pass: 19, total: 36 },
        devAfter: { pass: 25, total: 36 },
        regressions: [],
        reason:
          'Dev 19/36 to 25/36; the one-shot method keeps its harness without a keep-or-revert check',
      },
    ],
  },
  targeted: {
    dev: {
      baseline: { pass: 25, total: 36 },
      kept: {
        round: 3,
        kind: 'harness',
        before: { pass: 58, total: 72 },
        after: { pass: 65, total: 72 },
      },
    },
    rounds: { used: 4, ended: 'the round cap' },
    experiments: [
      {
        round: 1,
        kind: 'harness',
        title: "Read the metric names from the group's policy",
        disposition: 'kept',
        devBefore: { pass: 50, total: 72 },
        devAfter: { pass: 58, total: 72 },
        regressions: [],
        reason: 'Dev 25/36 to 29/36, measured again on new seeds: 50/72 to 58/72 over 2 runs',
      },
      {
        round: 2,
        kind: 'harness',
        title: 'Stop early on the smallest gain, not on any gain',
        disposition: 'reverted',
        devBefore: { pass: 29, total: 36 },
        devAfter: { pass: 28, total: 36 },
        regressions: [{ type: 'early_stop', before: 5, after: 4 }],
        reason: 'Dev 29/36 to 28/36; early stopping lost a task',
      },
      {
        round: 3,
        kind: 'harness',
        title: 'Pair runs by seed before comparing configs',
        disposition: 'kept',
        devBefore: { pass: 58, total: 72 },
        devAfter: { pass: 65, total: 72 },
        regressions: [],
        reason: 'Dev 29/36 to 33/36, measured again on new seeds: 58/72 to 65/72 over 2 runs',
      },
      {
        round: 4,
        kind: 'harness',
        title: 'List proposed runs config by config',
        disposition: 'reverted',
        devBefore: { pass: 33, total: 36 },
        devAfter: { pass: 33, total: 36 },
        regressions: [],
        reason: 'Dev 33/36 to 33/36; no gain to keep',
      },
    ],
  },
};

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** The finished experiment the Lab lists on Sweep desk. */
export const SWEEP_EXPERIMENT = (() => {
  const found = LAB_EXPERIMENTS.find((item) => item.input.jobId === SWEEP.job);
  if (!found) throw new Error('The Lab lists an experiment on Sweep desk.');
  return found;
})();

/** Sweep desk's experiment, released, built on the recorded comparison's spend and settings. */
export function sweepComparison(recorded: ComparisonReport): ComparisonReport {
  const hosted = recorded.backends.find((backend) => backend.backend === 'hosted');
  if (!hosted) throw new Error('The recorded comparison ran on hosted Glimmer.');
  const arms = ARMS.map((arm) => {
    const base = recorded.arms.find((item) => item.arm === arm);
    if (!base) throw new Error(`The recorded comparison has the ${arm} arm.`);
    return {
      ...base,
      ...DEVELOPMENT[arm],
      runId: `run_sweep_${arm}`,
      spent: { ...base.spent, sparkUsd: SPARK_USD[arm] },
      cumulative: base.cumulative && {
        ...base.cumulative,
        sparkUsd:
          sum(base.cumulative.builtOn.map((built) => SPARK_USD[built as Arm] ?? 0)) +
          SPARK_USD[arm],
      },
      measuredOn: ['hosted' as const],
      frozen: base.frozen ? { ...base.frozen, testSeeds: [101] } : null,
    };
  });
  const rows = ARMS.map((arm) => {
    const base = hosted.rows.find((item) => item.arm === arm && item.seed === 101);
    if (!base) throw new Error(`The recorded comparison tested the ${arm} arm.`);
    return row(base, arm);
  });
  const projection = recorded.projection && {
    ...recorded.projection,
    arms: recorded.projection.arms.filter((item) => (ARMS as readonly string[]).includes(item.arm)),
  };
  const calibration = recorded.calibration && {
    ...recorded.calibration,
    job: 'Sweep desk',
    tasks: 12,
    scenarios: counted(8, 12),
    perType: skills.map((skill, index) => ({
      ...counted(index % 3 === 0 ? 1 : 2, 2),
      type: skill.id,
      label: skill.label,
    })),
  };
  const armsUsd = sum(arms.map((arm) => arm.spent.studentUsd ?? 0));
  const calibrationUsd = recorded.totals.studentParts.calibrationUsd ?? 0;
  return ComparisonReportSchema.parse({
    ...recorded,
    dryRun: false,
    job: {
      id: SWEEP.job,
      name: 'Sweep desk',
      splitsSeed: SWEEP_EXPERIMENT.job.splitsSeed,
      counts: { calibration: 12, train: 60, dev: 36, test: TAUGHT_TEST },
    },
    plan: {
      ...recorded.plan,
      testSeeds: [101],
      seedResults: [{ seed: 101, arms: [...ARMS] }],
      order: [...ARMS],
    },
    inputs: SWEEP_EXPERIMENT.preregistration
      ? { job: SWEEP_EXPERIMENT.preregistration.pinned, regression: null }
      : null,
    calibration,
    regression: null,
    credit: null,
    totals: {
      sparkUsd: sum(arms.map((arm) => arm.spent.sparkUsd)),
      studentUsd: armsUsd + calibrationUsd,
      studentParts: { armsUsd, calibrationUsd, regressionUsd: null },
      computeUsd: 0,
      computeSettled: true,
    },
    projection,
    arms,
    backends: [
      {
        ...hosted,
        rows,
        paired: [
          pair('draft', 'bare', 'One-shot draft vs Glimmer alone'),
          pair('targeted', 'bare', 'Targeted mentoring vs Glimmer alone'),
          pair('targeted', 'draft', 'Targeted mentoring vs One-shot draft'),
        ],
        repeats: [],
      },
    ],
    adapters: [],
    disclosures: [
      'Claims rest on the final test alone. Check-task gains were picked by the keep rule, so they lean upward and are not claimed.',
      'Every arm ran with one mentoring seed (1). The final test ran under seed 101.',
      ...recorded.disclosures.filter((line) => line.startsWith("A pair's difference")),
      `The target is judged on the ${TAUGHT_TEST} final-test tasks of the three groups taught on; Fennick Research's ${SCENARIOS.length - TAUGHT_TEST}, a group no arm saw, are reported apart.`,
      "The arms' budgets differ and are not equal-budget comparisons.",
    ],
  });
}
