import type {
  Experiment,
  MentoringProgress,
  ReferenceRecord,
  ReportCard,
  Run,
  Score,
} from '@architect/shared';

/*
 * The comparisons the expanded spec asks for (section 17), from the records that exist: the
 * student untouched, with the mentor's setup only, with trained weights only, with both, and the
 * mentor doing the tasks itself. A comparison with no record is not run, and nothing is inferred
 * for it.
 */

export type ArmKey = 'untouched' | 'setup' | 'weights' | 'both' | 'mentor';

export const ARM_ORDER: readonly ArmKey[] = ['untouched', 'setup', 'weights', 'both', 'mentor'];

export interface ArmBudget {
  mentorUsd: number;
  computeUsd: number;
  computeMinutes: number;
}

export interface Arm {
  key: ArmKey;
  /** Check tasks, hidden from the mentor; null when this configuration wasn't measured on them. */
  check: Score | null;
  /** The locked final test; null when this configuration didn't take it. */
  final: Score | null;
  /** What the configuration cost, when a record says; null when it isn't recorded apart. */
  budget: ArmBudget | null;
  /** The configuration this agent is. */
  current: boolean;
}

export interface ArmInputs {
  run: Run;
  report: ReportCard;
  progress: MentoringProgress | null;
  experiments: readonly Experiment[];
  references: readonly ReferenceRecord[];
  /** The final test of a run with no setup on the same job and seed, when one ran. */
  bare: ReportCard | null;
}

/** The latest round that measured trained weights in all four configurations. */
function weightsExperiment(experiments: readonly Experiment[]): Experiment | null {
  const labels = ['H0/A0', 'H1/A0', 'H0/A1', 'H1/A1'];
  return (
    [...experiments]
      .reverse()
      .find(
        (experiment) =>
          experiment.kind === 'weights' &&
          labels.every((label) => experiment.measurements.some((item) => item.label === label)),
      ) ?? null
  );
}

/** Whether a reference measurement finished, so its numbers stand. */
function finished(records: readonly ReferenceRecord[], split: ReferenceRecord['split']) {
  return records.find((record) => record.split === split && record.status === 'finished') ?? null;
}

export function comparisonArms(inputs: ArmInputs): Arm[] {
  const { run, report, progress, experiments, references, bare } = inputs;
  const weights = weightsExperiment(experiments);
  const measured = (label: string) =>
    weights?.measurements.find((item) => item.label === label)?.score ?? null;
  const weightsBudget: ArmBudget | null = weights && {
    mentorUsd: weights.budget.mentorUsd,
    computeUsd: weights.budget.computeUsd,
    computeMinutes: weights.budget.computeMinutes,
  };
  // The agent is the setup alone, or the setup with the trained weights it kept.
  const agentKey: ArmKey = run.currentAdapter ? 'both' : 'setup';
  const agent: Arm = {
    key: agentKey,
    check: progress?.dev.current ?? run.devCurrent,
    final: report.test.score,
    budget: {
      mentorUsd: report.cost.mentorUsd,
      computeUsd: progress?.spent.computeUsd ?? 0,
      computeMinutes: progress?.spent.computeMinutes ?? 0,
    },
    current: true,
  };
  const dev = finished(references, 'dev');
  const test = finished(references, 'test');
  const arms: Record<ArmKey, Arm> = {
    untouched: {
      key: 'untouched',
      check: weights ? measured('H0/A0') : (progress?.dev.baseline ?? run.devBaseline),
      final: bare?.test.score ?? null,
      budget: { mentorUsd: 0, computeUsd: 0, computeMinutes: 0 },
      current: false,
    },
    setup:
      agentKey === 'setup'
        ? agent
        : { key: 'setup', check: measured('H1/A0'), final: null, budget: null, current: false },
    weights: {
      key: 'weights',
      check: measured('H0/A1'),
      final: null,
      budget: weightsBudget,
      current: false,
    },
    both:
      agentKey === 'both'
        ? agent
        : {
            key: 'both',
            check: measured('H1/A1'),
            final: null,
            budget: weightsBudget,
            current: false,
          },
    mentor: {
      key: 'mentor',
      check: dev?.score ?? null,
      final: test?.score ?? null,
      budget:
        dev || test
          ? {
              mentorUsd: (dev?.spentUsd ?? 0) + (test?.spentUsd ?? 0),
              computeUsd: 0,
              computeMinutes: 0,
            }
          : null,
      current: false,
    },
  };
  return ARM_ORDER.map((key) => arms[key]);
}

/** A comparison with no result of either kind wasn't run. */
export function wasRun(arm: Arm): boolean {
  return arm.check !== null || arm.final !== null;
}
