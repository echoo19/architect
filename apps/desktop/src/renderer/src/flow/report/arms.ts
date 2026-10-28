import type {
  Experiment,
  MentoringProgress,
  ReferenceRecord,
  ReportCard,
  Run,
  Score,
} from '@architect/shared';
import type { RuntimeFigures } from './evidence';

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
  /** The most memory a meter saw over its final test here; null where no meter read it. */
  memory: RuntimeFigures | null;
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
  /** The meter's figures for the agent's own final test, when a meter read it. */
  figures: RuntimeFigures | null;
}

/** A round's measurements on the check tasks; a smoke check on practice tasks isn't one. */
function onCheckTasks(experiment: Experiment) {
  return experiment.measurements.filter((item) => item.split !== 'train');
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
          labels.every((label) => onCheckTasks(experiment).some((item) => item.label === label)),
      ) ?? null
  );
}

/** Whether a reference measurement finished, so its numbers stand. */
function finished(records: readonly ReferenceRecord[], split: ReferenceRecord['split']) {
  return records.find((record) => record.split === split && record.status === 'finished') ?? null;
}

export function comparisonArms(inputs: ArmInputs): Arm[] {
  const { run, report, progress, experiments, references, bare, figures } = inputs;
  const weights = weightsExperiment(experiments);
  const measured = (label: string) =>
    (weights && onCheckTasks(weights).find((item) => item.label === label)?.score) ?? null;
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
    memory: figures,
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
      memory: null,
      current: false,
    },
    setup:
      agentKey === 'setup'
        ? agent
        : {
            key: 'setup',
            check: measured('H1/A0'),
            final: null,
            budget: null,
            memory: null,
            current: false,
          },
    weights: {
      key: 'weights',
      check: measured('H0/A1'),
      final: null,
      budget: weightsBudget,
      memory: null,
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
            memory: null,
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
      memory: null,
      current: false,
    },
  };
  return ARM_ORDER.map((key) => arms[key]);
}

/** A comparison with no result of either kind wasn't run. */
export function wasRun(arm: Arm): boolean {
  return arm.check !== null || arm.final !== null;
}

/**
 * Why a comparison wasn't run, from what the records lack, in a few words for its row. The
 * agent's own configuration always ran, so it has none.
 */
export function notRunReason(key: ArmKey, mentor: string): string | null {
  switch (key) {
    case 'untouched':
      return 'nothing was measured before training';
    case 'weights':
    case 'both':
      return 'no round measured trained weights';
    case 'mentor':
      return `${mentor} wasn't measured on these tasks`;
    case 'setup':
      return null;
  }
}
