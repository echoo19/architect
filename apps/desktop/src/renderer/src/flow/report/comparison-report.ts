import type {
  ArmId,
  ArmRow,
  ArmStatus,
  BackendId,
  ComparisonReport,
  Spend,
} from '@architect/shared';
import type { ModelNames } from '../train/phase';

/*
 * The comparisons runner's report (decision 045) as the Report screen's table reads it: one row
 * per arm in decision 037's order, each with its final test where it ran, the most memory a
 * meter saw where one ran, and what it spent. An arm that wasn't run says so, with the reason.
 */

/** A final test's result, with the same arm's result under the plan's other seed, if it ran. */
export interface ArmScore {
  pass: number;
  total: number;
  /** False when fewer scenarios ran than the test holds: a paused or capped evaluation. */
  complete: boolean;
  /** The 95% Wilson interval the report gives, so two close rows read as close. */
  range: { low: number; high: number } | null;
  /** The second seed's result; not complete when it ran fewer scenarios than the test holds. */
  repeat: { seed: number; pass: number; total: number; complete: boolean } | null;
  /**
   * The same setup without the trained weights on the same test, when the test measured both
   * (decision 051's reduced protocol), so the weights' own effect reads beside the result.
   */
  without: { pass: number; total: number } | null;
}

export interface ReportArm {
  arm: ArmId;
  label: string;
  status: ArmStatus;
  reason: string | null;
  /** The run this report is for. */
  current: boolean;
  /** On the hosted copy; for Spark doing the tasks itself, Spark's own. */
  hosted: ArmScore | null;
  /** On this computer, on Ollama or on llama-server. */
  local: ArmScore | null;
  memory: { processBytes: number | null; gpuBytes: number | null } | null;
  spent: Spend;
}

/** Each arm named for what the student ran with, in the job's own model names. */
export function armLabel(arm: ArmId, { mentor, student }: ModelNames): string {
  switch (arm) {
    case 'bare':
      return `${student}, untouched`;
    case 'draft':
      return `${student} with a setup ${mentor} wrote in one go`;
    case 'targeted':
      return `${student} taught by ${mentor}`;
    case 'reference':
      return `${mentor} doing the tasks itself, no setup`;
    case 'reference-targeted':
      return `${mentor} doing the tasks itself, with ${student}'s final setup`;
    case 'teacher':
      return `${mentor} doing the job itself, untaught, in a run of its own`;
    case 'repeat':
      return 'The first three, tested a second time';
    case 'fixed':
      return `${student} taught with written rules only`;
    case 'weights-one-shot':
      return `${student} with weights trained once on sample tasks`;
    case 'weights-targeted':
      return `${student} with weights trained on its failures`;
  }
}

/**
 * An arm's row in a backend's table under one seed: its own result (its one row, or the one with
 * its trained weights when it has both), or the one without them.
 */
function rowIn(
  report: ComparisonReport,
  backend: BackendId,
  arm: ArmId,
  seed: number,
  which: 'own' | 'without' = 'own',
) {
  const own = (row: ArmRow) => row.configuration === null || row.configuration === 'H1/A1';
  return (
    report.backends
      .find((table) => table.backend === backend)
      ?.rows.find(
        (row) =>
          row.arm === arm &&
          row.seed === seed &&
          (which === 'own' ? own(row) : row.configuration === 'H1/A0'),
      ) ?? null
  );
}

function scoreOf(
  report: ComparisonReport,
  backend: BackendId,
  arm: ArmId,
  row: ArmRow | null,
  without: ArmRow | null,
): ArmScore | null {
  if (row === null) return null;
  // A repeat is the same configuration's, so it carries the row's own label.
  const repeat = report.backends
    .find((table) => table.backend === backend)
    ?.repeats.find((item) => item.arm === arm && item.label === row.label);
  const other = repeat?.seeds.find((item) => item.seed !== row.seed) ?? null;
  return {
    pass: row.scenarios.pass,
    total: row.scenarios.total,
    complete: row.complete,
    range: row.scenarios.wilson95,
    repeat: other && {
      seed: other.seed,
      pass: other.score.pass,
      total: other.score.total,
      complete: repeat?.complete ?? true,
    },
    without: without && { pass: without.scenarios.pass, total: without.scenarios.total },
  };
}

/** The arms in the report's order, each read from its own records and nothing else. */
export function reportArms(
  report: ComparisonReport,
  runId: string,
  names: ModelNames,
): ReportArm[] {
  const seed = report.plan.testSeeds[0] ?? 101;
  return report.arms.map((arm) => {
    // Spark's own results sit in a table of their own, beside the hosted copy's, and so do the
    // teacher alone's.
    const spark = arm.arm === 'reference' || arm.arm === 'reference-targeted';
    const hostedOn: BackendId = spark ? 'reference' : arm.arm === 'teacher' ? 'teacher' : 'hosted';
    const hostedRow = rowIn(report, hostedOn, arm.arm, seed);
    const localOn: BackendId = rowIn(report, 'local-llama.cpp', arm.arm, seed)
      ? 'local-llama.cpp'
      : 'local-ollama';
    const localRow = rowIn(report, localOn, arm.arm, seed);
    return {
      arm: arm.arm,
      label: armLabel(arm.arm, names),
      status: arm.status,
      reason: arm.reason,
      current: arm.runId !== null && arm.runId === runId,
      hosted: scoreOf(
        report,
        hostedOn,
        arm.arm,
        hostedRow,
        rowIn(report, hostedOn, arm.arm, seed, 'without'),
      ),
      local: scoreOf(
        report,
        localOn,
        arm.arm,
        localRow,
        rowIn(report, localOn, arm.arm, seed, 'without'),
      ),
      memory: localRow?.peakMemory ?? null,
      spent: arm.spent,
    };
  });
}
