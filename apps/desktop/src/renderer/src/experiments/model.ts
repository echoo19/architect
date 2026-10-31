import {
  ArmIdSchema,
  ExperimentInputSchema,
  type ArmId,
  type ArmReport,
  type ArmRow,
  type BackendId,
  type BackendTable,
  type ComparisonReport,
  type ExperimentGroup,
  type ExperimentInput,
  type ExperimentStatus,
  type Paired,
  type PassDifference,
  type PrimaryComparison,
} from '@architect/shared';

/*
 * What the experiment screens say about an experiment, worked out from its stored records only:
 * status words, the arms on offer, the groups a final test splits into, and the gain rule.
 */

export const STATUS_WORDS: Record<ExperimentStatus, string> = {
  draft: 'Draft',
  calibrating: 'Calibrating',
  preregistered: 'Preregistered',
  running: 'Running',
  paused: 'Paused',
  waiting: 'Waiting',
  needs_funding: 'Needs funding',
  incomplete: 'Incomplete',
  finished: 'Finished',
  stopped: 'Stopped',
  failed: 'Failed',
};

/** An arm whose teaching ended and whose harness is frozen until results open, said plainly. */
export const DONE_TEACHING = 'Done teaching';

/** The arm's state in a few words; an unfinished arm of a running experiment is running. */
export function armStatusWord(arm: ArmReport, experiment: ExperimentStatus): string {
  switch (arm.status) {
    case 'complete':
      return arm.frozen === null ? 'Done' : DONE_TEACHING;
    case 'stopped':
      return arm.frozen === null ? 'Stopped' : DONE_TEACHING;
    case 'not_run':
      return 'Not run';
    case 'incomplete':
      if (arm.frozen !== null) return DONE_TEACHING;
      return experiment === 'running' ? 'Running' : 'Unfinished';
  }
}

/** Every arm the runner takes, in its order, under the names the tiles use. */
export const ARM_NAMES: Record<ArmId, string> = {
  bare: 'Bare student',
  draft: 'One-shot draft',
  targeted: 'Targeted mentoring',
  reference: 'Spark reference',
  'reference-targeted': 'Spark, targeted harness',
  repeat: 'Decoding repeat',
  fixed: 'Fixed intervention',
  'weights-one-shot': 'One-shot adapter',
  'weights-targeted': 'Failure-specific adapter',
};

/** What each arm does, in one plain line under its name. */
export const ARM_DESCRIPTIONS: Record<ArmId, string> = {
  bare: 'Glimmer alone, with no teaching',
  draft: 'Spark writes one harness before any practice',
  targeted: "Spark edits the harness round by round from Glimmer's failures",
  reference: 'Spark takes the test itself, with a blank harness',
  'reference-targeted': 'Spark takes the test itself, with the taught harness',
  repeat: 'The finished arms tested again on a new seed, to show the noise',
  fixed: 'Spark may use one kind of change only',
  'weights-one-shot': "Retrains Glimmer's weights once on verified examples",
  'weights-targeted': "Retrains Glimmer's weights on the failures Spark found",
};

export const ARMS: readonly ArmId[] = ArmIdSchema.options;

/** The arms that train weights: they need this computer's GPU, which the app never uses. */
export const WEIGHT_ARMS: ReadonlySet<ArmId> = new Set(['weights-one-shot', 'weights-targeted']);

/** Arms that call Spark, so a Spark cap of their own means something. */
export const SPARK_ARMS: readonly ArmId[] = [
  'draft',
  'targeted',
  'reference',
  'reference-targeted',
  'fixed',
];

/** Arms the hosted student answers in, so a student cap of their own means something. */
export const STUDENT_ARMS: readonly ArmId[] = ['bare', 'draft', 'targeted', 'repeat', 'fixed'];

/**
 * A new experiment's plan before the person changes it: the runner's usual arms and seeds, on a
 * field of the library or a job folder. Its hypothesis is the person's to state.
 */
export function defaultInput(
  source: { jobId: string } | { jobDir: string },
  name: string,
): ExperimentInput {
  return {
    name,
    ...source,
    arms: [{ arm: 'bare' }, { arm: 'draft' }, { arm: 'targeted' }, { arm: 'reference' }],
    seeds: { mentoring: 1, lockedTest: [101] },
    rounds: 4,
    caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, wallMinutes: 720 },
  };
}

/**
 * The arms asked for, in the runner's order, keeping each arm's own caps. A primary comparison of
 * an arm no longer asked for is cleared, to be chosen again.
 */
export function withArms(input: ExperimentInput, arms: readonly ArmId[]): ExperimentInput {
  const kept = new Map(input.arms.map((item) => [item.arm, item]));
  const next: ExperimentInput = {
    ...input,
    arms: ARMS.filter((arm) => arms.includes(arm)).map((arm) => kept.get(arm) ?? { arm }),
  };
  const primary = input.primaryComparison;
  if (primary !== undefined && (!arms.includes(primary.a) || !arms.includes(primary.b))) {
    delete next.primaryComparison;
  }
  return next;
}

/** Each part of the final test a primary comparison can read, in words. */
export const GROUP_WORDS: Record<ExperimentGroup, string> = {
  all: 'the whole final test',
  seen: 'the organizations it is taught on',
  unseen: 'the organizations it never sees',
};

/** The primary comparison in one line: "Targeted mentoring minus Bare student, on …". */
export function primaryText(input: ExperimentInput): string | null {
  const primary = input.primaryComparison;
  if (primary === undefined) return null;
  return `${ARM_NAMES[primary.a]} minus ${ARM_NAMES[primary.b]}, on ${GROUP_WORDS[primary.group]}`;
}

/** What keeps a plan from being preregistered beyond being sent, in a sentence; null when nothing. */
export function preregisterProblem(
  input: ExperimentInput,
  groups: readonly ExperimentGroup[],
): string | null {
  if ((input.hypothesis ?? '').trim() === '') return 'State the hypothesis.';
  const primary = input.primaryComparison;
  if (primary === undefined) return 'Choose the primary comparison.';
  const arms = input.arms.map((item) => item.arm);
  if (!arms.includes(primary.a) || !arms.includes(primary.b)) {
    return 'Compare two of the chosen arms.';
  }
  return groups.includes(primary.group) ? null : 'Choose a part of the final test this field has.';
}

/** One arm's own cap set, or cleared back to the runner's with `undefined`. */
export function withArmCap(
  input: ExperimentInput,
  arm: ArmId,
  kind: 'sparkUsd' | 'studentUsd',
  value: number | undefined,
): ExperimentInput {
  return {
    ...input,
    arms: input.arms.map((item) => {
      if (item.arm !== arm) return item;
      const next = { ...item };
      delete next[kind];
      return value === undefined ? next : { ...next, [kind]: value };
    }),
  };
}

const Z95 = 1.959963984540054;

/**
 * The 95% Wilson score interval of `pass` in `total`, the report's own interval for a pass rate.
 * Null when nothing was counted.
 */
export function wilson(pass: number, total: number): { low: number; high: number } | null {
  if (total === 0) return null;
  const p = pass / total;
  const z2 = Z95 * Z95;
  const centre = (p + z2 / (2 * total)) / (1 + z2 / total);
  const half =
    (Z95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / (1 + z2 / total);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** A part of the final test: all of it, the organizations taught on, or one never seen. */
export interface TestGroup {
  key: string;
  label: string;
}

const ALL: TestGroup = { key: 'all', label: '' };
const SEEN: TestGroup = { key: 'seen', label: 'Organizations it was taught on' };

/** The group of the final test a primary comparison reads. */
export function primaryGroup(group: ExperimentGroup): TestGroup {
  if (group === 'all') return ALL;
  return group === 'seen' ? SEEN : { key: 'unseen', label: 'Organizations it never saw' };
}

/** Whether an organization's results belong to a group of the final test. */
function inGroup(result: { seen: boolean; org: string }, group: TestGroup): boolean {
  if (group.key === 'seen') return result.seen;
  if (group.key === 'unseen') return !result.seen;
  return result.org === group.key;
}

/**
 * The groups the final test splits into: for a job with organizations, those it was taught on
 * together, then each it never saw; otherwise the test as one.
 */
export function groupsOf(rows: readonly ArmRow[]): TestGroup[] {
  const results = rows.flatMap((row) => row.perOrg ?? []);
  if (results.length === 0) return [ALL];
  const unseen = new Map<string, TestGroup>();
  for (const result of results) {
    if (result.seen || unseen.has(result.org)) continue;
    unseen.set(result.org, {
      key: result.org,
      label: result.synthetic
        ? `${result.orgName}, never seen`
        : `${result.orgName}, real, never seen`,
    });
  }
  return [...(results.some((result) => result.seen) ? [SEEN] : []), ...unseen.values()];
}

/** A row's passes in one group, with its interval; null where it has no task there. */
export function countIn(
  row: ArmRow,
  group: TestGroup,
): { pass: number; total: number; low: number; high: number } | null {
  if (group.key === 'all') {
    const { pass, total, wilson95 } = row.scenarios;
    return total === 0 || wilson95 === null ? null : { pass, total, ...wilson95 };
  }
  const here = (row.perOrg ?? []).filter((result) => inGroup(result, group));
  const pass = here.reduce((sum, result) => sum + result.pass, 0);
  const total = here.reduce((sum, result) => sum + result.total, 0);
  const interval = wilson(pass, total);
  return interval === null ? null : { pass, total, ...interval };
}

/** A skill's passes in one group of one row; null where it has no task there. */
export function skillIn(
  row: ArmRow,
  group: TestGroup,
  type: string,
): { pass: number; total: number } | null {
  if (group.key === 'all') {
    const found = row.perType.find((item) => item.type === type);
    return found === undefined || found.total === 0 ? null : found;
  }
  const here = (row.perOrg ?? []).filter(
    (result) => result.type === type && inGroup(result, group),
  );
  const total = here.reduce((sum, result) => sum + result.total, 0);
  if (total === 0) return null;
  return { pass: here.reduce((sum, result) => sum + result.pass, 0), total };
}

/** The skills a row was tested on, by their type and name. */
export function skillsOf(row: ArmRow): { type: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const item of [...row.perType, ...(row.perOrg ?? [])]) seen.set(item.type, item.label);
  return [...seen].map(([type, label]) => ({ type, label }));
}

/** A row's name: the arm's, with its configuration when the arm has more than one. */
export function rowLabel(row: ArmRow): string {
  const name = ARM_NAMES[row.arm];
  return row.configuration === null ? name : `${name} (${row.configuration})`;
}

/** The first declared seed's rows: every arm's one result, as the paired counts use. */
export function firstSeedRows(report: ComparisonReport, backend: BackendTable): ArmRow[] {
  const seed = report.plan.testSeeds[0];
  return backend.rows.filter((row) => row.seed === seed);
}

/**
 * The figures of a report: one per backend the student ran on, Spark's reference rows beside the
 * hosted student's, since they share its tasks, tools, limits and seed.
 */
export function figuresOf(report: ComparisonReport): Measured[] {
  const seed = report.plan.testSeeds[0];
  const pairsOf = (backend: BackendTable) => backend.paired.filter((pair) => pair.seed === seed);
  const reference = report.backends.find((backend) => backend.backend === 'reference');
  const students = report.backends.filter((backend) => backend.backend !== 'reference');
  const beside = (backend: BackendTable) => backend.backend === 'hosted' && reference;
  const figures = students.map((backend) => ({
    backend,
    rows: [
      ...firstSeedRows(report, backend),
      ...(beside(backend) && reference ? firstSeedRows(report, reference) : []),
    ],
    pairs: [...pairsOf(backend), ...(beside(backend) && reference ? pairsOf(reference) : [])],
  }));
  if (figures.length === 0 && reference) {
    return [
      { backend: reference, rows: firstSeedRows(report, reference), pairs: pairsOf(reference) },
    ];
  }
  return figures.filter((figure) => figure.rows.length > 0);
}

/** One place the student ran, with its rows and pairings under the first declared seed. */
export interface Measured {
  backend: BackendTable;
  rows: ArmRow[];
  pairs: Paired[];
}

/** Where the student ran, in a word or two. */
export const BACKEND_NAMES: Record<BackendId, string> = {
  hosted: 'Hosted',
  reference: 'Spark',
  'local-ollama': 'Ollama',
  'local-llama.cpp': 'llama-server',
};

/** A pairing in words: the two arms, or the pair's own label when an arm meets itself. */
export function pairName(pair: Paired): string {
  return pair.a === pair.b ? pair.label : `${ARM_NAMES[pair.a]} vs ${ARM_NAMES[pair.b]}`;
}

export type Verdict = 'gain' | 'loss' | 'none';

/**
 * The gain rule: a gain counts only when the whole 95% interval of the paired difference is above
 * zero; one wholly below zero is a loss; anything else shows no difference either way.
 */
export function verdictOf(difference: PassDifference): Verdict {
  if (difference.low > 0) return 'gain';
  if (difference.high < 0) return 'loss';
  return 'none';
}

export const VERDICT_WORDS: Record<Verdict, string> = {
  gain: 'Gain shown',
  loss: 'Loss shown',
  none: 'No gain shown',
};

const percent = (pass: number, total: number) => `${((pass / total) * 100).toFixed(1)}%`;

/**
 * What the released results say about the primary comparison, in a sentence, where the student
 * ran first: on the whole test, the paired difference with its interval and the gain rule; on a
 * part of it, each arm's pass rate there and the difference. Null where either arm has nothing.
 */
export function primaryResult(report: ComparisonReport, primary: PrimaryComparison): string | null {
  const [figure] = figuresOf(report);
  if (figure === undefined) return null;
  const pair = figure.pairs.find((item) => item.a === primary.a && item.b === primary.b);
  if (primary.group === 'all' && pair !== undefined) {
    const { rate, low, high } = pair.difference;
    return `${points(rate)} points, 95% interval ${points(low)} to ${points(high)}: ${VERDICT_WORDS[verdictOf(pair.difference)].toLowerCase()}.`;
  }
  const rowOf = (arm: ArmId) =>
    figure.rows.find((row) => row.arm === arm && row.configuration === null);
  const group = primaryGroup(primary.group);
  const a = rowOf(primary.a);
  const b = rowOf(primary.b);
  const countA = a === undefined ? null : countIn(a, group);
  const countB = b === undefined ? null : countIn(b, group);
  if (countA === null || countB === null) return null;
  const rate = countA.pass / countA.total - countB.pass / countB.total;
  return `${ARM_NAMES[primary.a]} ${percent(countA.pass, countA.total)} of ${countA.total}, ${ARM_NAMES[primary.b].toLowerCase()} ${percent(countB.pass, countB.total)} of ${countB.total}: ${points(rate)} points.`;
}

/** A share as signed percentage points, one decimal, with a true minus: "+23.3", "−1.3". */
export function points(rate: number): string {
  const text = Math.abs(rate * 100).toFixed(1);
  if (text === '0.0') return text;
  return `${rate > 0 ? '+' : '−'}${text}`;
}

/**
 * The pairing a summary leads with: targeted mentoring against the bare student on the hosted
 * student where it was measured, else the first pairing there is.
 */
export function leadPair(report: ComparisonReport) {
  const seed = report.plan.testSeeds[0];
  const pairs = report.backends.flatMap((backend) =>
    backend.paired.filter((pair) => pair.seed === seed).map((pair) => ({ backend, pair })),
  );
  return (
    pairs.find(
      ({ backend, pair }) =>
        backend.backend === 'hosted' && pair.a === 'targeted' && pair.b === 'bare',
    ) ??
    pairs.find(({ pair }) => pair.b === 'bare') ??
    pairs[0] ??
    null
  );
}

/** What keeps a plan from being sent, in a sentence; null when it can be. */
export function inputProblem(input: ExperimentInput): string | null {
  if (input.name.trim() === '') return 'Name the experiment.';
  if (input.arms.length === 0) return 'Choose at least one arm.';
  if (input.seeds.lockedTest.length === 0) return 'Give the final test at least one seed.';
  return ExperimentInputSchema.safeParse(input).success
    ? null
    : 'One of the settings is out of range.';
}

/** "40 min", "2 h 5 min", from minutes. */
export function minutesText(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${Math.max(whole, minutes > 0 ? 1 : 0)} min`;
  const hours = Math.floor(whole / 60);
  return whole % 60 === 0 ? `${hours} h` : `${hours} h ${whole % 60} min`;
}
