import {
  WSP_MIN_EXAMPLES,
  WspExampleSchema,
  type WspCheck,
  type WspExample,
  type WspExperiment,
  type WspIteration,
  type WspMeasurement,
  type WspMentor,
  type WspStage,
  type WspStatus,
  type WspTarget,
  type WspVerdict,
} from '@architect/shared';

/* Words */

export const STATUS_WORDS: Record<WspStatus, string> = {
  briefing: 'Drafting',
  brief: 'Brief',
  running: 'Running',
  cancelling: 'Stopping',
  interrupted: 'Interrupted',
  evaluated: 'Evaluated',
  qualifying: 'Qualifying',
  qualified: 'Qualified',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export const STAGES: readonly WspStage[] = [
  'baseline',
  'investigation',
  'edit',
  'evaluation',
  'results',
];

export const STAGE_WORDS: Record<WspStage, string> = {
  baseline: 'Baseline',
  investigation: 'Investigation',
  edit: 'Proposed edit',
  evaluation: 'Candidate evaluation',
  results: 'Results',
};

export const VERDICT_WORDS: Record<WspVerdict, string> = {
  improved: 'Improved',
  'not-established': 'Not established',
  regressed: 'Regressed',
  'no-candidate': 'No candidate',
};

export const OUTCOME_WORDS: Record<WspIteration['outcome'], string> = {
  edit: 'Edit',
  read: 'Read',
  inspected: 'Inspected',
  error: 'Error',
  timeout: 'Timeout',
  refused: 'Refused',
};

export const ARM_WORDS: Record<WspMeasurement['arm'], string> = {
  base: 'Base',
  decoding: 'Decoding control',
  instructions: 'Instructions control',
  candidate: 'Candidate',
};

export const METRIC_WORDS: Record<WspTarget['metric'], string> = {
  pass_rate: 'Pass rate',
  loop_rate: 'Loop rate',
};

/** The mentor as the screens name it: a stand-in is never shown under the real model's name. */
export function mentorName(mentor: WspMentor): string {
  return mentor.standIn ? 'Stand-in mentor' : mentor.label;
}

/* The flow */

/** An experiment still being briefed is shown in the flow; one that started is shown as a run. */
export function inBrief(experiment: Pick<WspExperiment, 'status' | 'approval'>): boolean {
  return (
    experiment.status === 'briefing' ||
    experiment.status === 'brief' ||
    (experiment.status === 'failed' && experiment.approval === null)
  );
}

/* Examples */

export interface ParsedExamples {
  examples: WspExample[];
  /** Each line that couldn't be read, by its number, with why. */
  problems: { line: number; reason: string }[];
}

/**
 * Examples from a JSONL file, one `{"prompt": ..., "check": {"kind": ..., "value": ...}}` per
 * line. Blank lines are skipped; a line that isn't an example is named with what is wrong.
 */
export function parseExamplesJsonl(text: string): ParsedExamples {
  const examples: WspExample[] = [];
  const problems: ParsedExamples['problems'] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      problems.push({ line: index + 1, reason: 'Not JSON' });
      return;
    }
    const parsed = WspExampleSchema.safeParse(value);
    if (parsed.success) {
      examples.push(parsed.data);
    } else {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join('.') ?? '';
      problems.push({
        line: index + 1,
        reason: where === '' ? 'Not an example' : `${where}: ${issue?.message ?? 'not valid'}`,
      });
    }
  });
  return { examples, problems };
}

export type CheckKind = WspCheck['kind'] | 'none';

export const CHECK_WORDS: Record<CheckKind, string> = {
  none: 'No check',
  contains: 'Contains',
  exact: 'Exact',
  regex: 'Regex',
  number: 'Number',
};

/** An example as the form holds it while the person types. */
export interface ExampleRow {
  id: number;
  prompt: string;
  kind: CheckKind;
  value: string;
}

export function rowOf(example: WspExample, id: number): ExampleRow {
  return {
    id,
    prompt: example.prompt,
    kind: example.check?.kind ?? 'none',
    value: example.check?.value ?? '',
  };
}

/**
 * The examples the rows make, and how many rows aren't one yet: a prompt left empty, or a check
 * chosen without its value. A row left wholly empty is no example and no problem.
 */
export function examplesOf(rows: readonly ExampleRow[]): {
  examples: WspExample[];
  incomplete: number;
} {
  const examples: WspExample[] = [];
  let incomplete = 0;
  for (const row of rows) {
    const prompt = row.prompt.trim();
    const value = row.value.trim();
    if (prompt === '' && value === '') continue;
    const parsed = WspExampleSchema.safeParse(
      row.kind === 'none' ? { prompt } : { prompt, check: { kind: row.kind, value } },
    );
    if (parsed.success) examples.push(parsed.data);
    else incomplete += 1;
  }
  return { examples, incomplete };
}

export interface SplitCounts {
  practice: number;
  dev: number;
  qualification: number;
}

/**
 * How many examples go to each split, before the engine splits them: a quarter sealed for
 * qualification, a quarter for dev, the rest for practice. Nothing below the minimum is split.
 */
export function splitCounts(total: number): SplitCounts | null {
  if (total < WSP_MIN_EXAMPLES) return null;
  const qualification = Math.floor(total / 4);
  const dev = Math.floor(total / 4);
  return { practice: total - qualification - dev, dev, qualification };
}

/* The run */

export type StageState = 'done' | 'current' | 'next';

/**
 * Each stage's state: done before the current one, the current one, and the rest to come. Once
 * qualified, every stage is done.
 */
export function stageStates(stage: WspStage, status: WspStatus): StageState[] {
  const at = status === 'qualified' ? STAGES.length : STAGES.indexOf(stage);
  return STAGES.map((_, index) => (index < at ? 'done' : index === at ? 'current' : 'next'));
}

/** A measurement's rate for a metric, in points; null when it has nothing to count. */
export function ratePoints(
  measurement: WspMeasurement,
  metric: WspTarget['metric'],
): number | null {
  if (metric === 'pass_rate') {
    if (measurement.passed === null || measurement.checked === 0) return null;
    return (measurement.passed / measurement.checked) * 100;
  }
  return measurement.n === 0 ? null : (measurement.looped / measurement.n) * 100;
}

/** The newest measurement of an arm on a split, or null when it hasn't been measured there. */
export function latest(
  measurements: readonly WspMeasurement[],
  arm: WspMeasurement['arm'],
  split: WspMeasurement['split'],
): WspMeasurement | null {
  return measurements.findLast((item) => item.arm === arm && item.split === split) ?? null;
}

/**
 * What a program's candidate changed on dev against the base, in points of the brief's metric;
 * null when either wasn't measured.
 */
export function devChange(
  iteration: WspIteration,
  base: WspMeasurement | null,
  metric: WspTarget['metric'],
): number | null {
  if (!iteration.dev || !base) return null;
  const candidate = ratePoints(iteration.dev, metric);
  const before = ratePoints(base, metric);
  return candidate === null || before === null ? null : candidate - before;
}

/** The metric an experiment is judged on: its brief's, or pass rate before it has one. */
export function metricOf(experiment: WspExperiment): WspTarget['metric'] {
  return experiment.brief?.target.metric ?? 'pass_rate';
}

/**
 * The best change any program's candidate measured on dev, against the base: the most gained in
 * pass rate, or the most cut in loop rate. Null when none was measured.
 */
export function bestChange(experiment: WspExperiment): number | null {
  const metric = metricOf(experiment);
  const base = latest(experiment.measurements, 'base', 'dev');
  const changes = experiment.iterations
    .map((iteration) => devChange(iteration, base, metric))
    .filter((change): change is number => change !== null);
  if (changes.length === 0) return null;
  return metric === 'pass_rate' ? Math.max(...changes) : Math.min(...changes);
}

/** "+8 points", "−4 points", "0 points": a change in a score always carries its unit. */
export function pointsText(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  const figure = Math.abs(rounded).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${figure} ${Math.abs(rounded) === 1 ? 'point' : 'points'}`;
}

/** "0.6B", "1.7B", "135M": a model's size in parameters. */
export function parametersText(count: number): string {
  if (count >= 1e9) return `${Number((count / 1e9).toFixed(1))}B`;
  if (count >= 1e6) return `${Math.round(count / 1e6)}M`;
  return count.toLocaleString('en-US');
}

/** "8 min", "1 h 20 min": wall time, from minutes. */
export function minutesText(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  return whole % 60 === 0 ? `${hours} h` : `${hours} h ${whole % 60} min`;
}

/** A digest or commit cut to what a person compares by eye. */
export function short(hash: string, length = 12): string {
  return hash.slice(0, length);
}
