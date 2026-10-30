import type { EvaluationConfig, Score, TypeScore } from '@architect/shared';
import { compareText } from './seeds';

/** One dev measurement of the incumbent and its candidate, adding up every run it took. */
export interface Measurement {
  /** Dev score of the incumbent (the last kept version), measured again for this comparison. */
  before: Score;
  /** Dev score of the candidate, on the same dev tasks and seeds. */
  after: Score;
  beforePerType: TypeScore[];
  afterPerType: TypeScore[];
}

type KeepLimits = Pick<EvaluationConfig, 'minDevGain' | 'maxTypeRegression'>;

export interface KeepInput extends Measurement {
  evaluation: KeepLimits;
  /** How many dev runs the scores add up; both limits scale with it. */
  runs: number;
}

export interface KeepDecision {
  keep: boolean;
  /** One line a person can read, e.g. "Dev 14/30 → 17/30, no type lost more than one". */
  reason: string;
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

function inWords(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function formatScore(score: Score): string {
  return `${score.pass}/${score.total}`;
}

/** The task type that lost the most dev passes, if any lost one. Ties go to the first by name. */
function worstTypeLoss(
  before: TypeScore[],
  after: TypeScore[],
): { type: string; lost: number } | null {
  let worst: { type: string; lost: number } | null = null;
  for (const type of [...before].sort((a, b) => compareText(a.type, b.type))) {
    const lost = type.pass - (after.find((t) => t.type === type.type)?.pass ?? 0);
    if (lost > 0 && (worst === null || lost > worst.lost)) worst = { type: type.type, lost };
  }
  return worst;
}

interface Verdict {
  keep: boolean;
  /** The two scores, e.g. "14/30 → 17/30 over 2 runs". */
  scores: string;
  /** Why, e.g. "no type lost more than one" or "short of the +2 margin". */
  detail: string;
}

function judge(measurement: Measurement, evaluation: KeepLimits, runs: number): Verdict {
  const { before, after } = measurement;
  const margin = evaluation.minDevGain * runs;
  const allowedLoss = evaluation.maxTypeRegression * runs;
  const scores = `${formatScore(before)} → ${formatScore(after)}${runs === 1 ? '' : ` over ${runs} runs`}`;
  const gain = after.pass - before.pass;

  if (gain < margin) {
    const detail =
      gain === 0 ? 'no change' : gain < 0 ? `down ${-gain}` : `short of the +${margin} margin`;
    return { keep: false, scores, detail };
  }

  const worst = worstTypeLoss(measurement.beforePerType, measurement.afterPerType);
  if (worst !== null && worst.lost > allowedLoss) {
    const passes = worst.lost === 1 ? 'pass' : 'passes';
    return { keep: false, scores, detail: `but ${worst.type} lost ${worst.lost} ${passes}` };
  }

  const detail =
    allowedLoss === 0 ? 'no type lost a pass' : `no type lost more than ${inWords(allowedLoss)}`;
  return { keep: true, scores, detail };
}

/**
 * Whether a change did harm, rather than only failing to help: dev passes fell overall, or a
 * task type lost more passes than the per-type limit allows for the runs measured.
 */
export function isHarmful(input: KeepInput): boolean {
  if (input.after.pass < input.before.pass) return true;
  const worst = worstTypeLoss(input.beforePerType, input.afterPerType);
  return worst !== null && worst.lost > input.evaluation.maxTypeRegression * input.runs;
}

/**
 * Keep a change only if net dev passes rise by at least the margin and no task type loses more
 * than the allowed number of passes (decision 007). Scores add up every run, so both limits
 * scale with the run count. Anything else is reverted.
 */
export function decideKeep(input: KeepInput): KeepDecision {
  const verdict = judge(input, input.evaluation, input.runs);
  return { keep: verdict.keep, reason: `Dev ${verdict.scores}, ${verdict.detail}` };
}

/** One task an improvement's round checked a lesson on, and whether the student passed it. */
export interface LearnedTask {
  taskId: string;
  type: string;
  pass: boolean;
}

export interface LearnedInput extends KeepInput {
  /** The round's failed train tasks of its lessons' types, attempted again with the change. */
  learned: readonly LearnedTask[];
}

/**
 * An improvement's keep rule (decision 066): the student, with the change, passes every task of
 * its lessons' types it had failed in the round, and the change does no harm on dev, judged by
 * `isHarmful`. A net dev gain isn't asked for, since an agent near its ceiling has none to give.
 * Ordinary training keeps `decideKeep`.
 */
export function decideLearned(input: LearnedInput): KeepDecision {
  const passed = input.learned.filter((task) => task.pass).length;
  const total = input.learned.length;
  const scores = `${formatScore(input.before)} → ${formatScore(input.after)}`;
  const check = `check tasks ${scores}`;
  if (total === 0) {
    return {
      keep: false,
      reason: `Not verified: it failed no task of its lessons' types in this round; ${check}`,
    };
  }
  const tried = `passed ${passed} of ${total} ${total === 1 ? 'task' : 'tasks'} it had failed`;
  if (passed < total) return { keep: false, reason: `Not learned: ${tried}; ${check}` };
  if (!isHarmful(input)) {
    return { keep: true, reason: `Learned: ${tried}; check tasks held ${scores}` };
  }
  const worst = worstTypeLoss(input.beforePerType, input.afterPerType);
  const harm =
    input.after.pass < input.before.pass || worst === null
      ? `check tasks fell ${scores}`
      : `${worst.type} lost ${worst.lost} ${worst.lost === 1 ? 'pass' : 'passes'}; ${check}`;
  return { keep: false, reason: `Learned: ${tried}, but ${harm}` };
}

export interface ConfirmInput {
  /** The measurement that cleared the limits. */
  first: Measurement;
  /** Both measurements added up: the first and a second under new seeds. */
  both: Measurement;
  evaluation: KeepLimits;
  /** Dev runs in one measurement. */
  runs: number;
}

/**
 * The decision for a change whose first measurement cleared the limits and that was measured
 * again under new seeds: kept only if the totals over both clear the limits for twice the runs.
 * The second measurement needn't clear them alone (decision 022).
 */
export function confirmKeep(input: ConfirmInput): KeepDecision {
  const first = judge(input.first, input.evaluation, input.runs);
  const both = judge(input.both, input.evaluation, 2 * input.runs);
  return {
    keep: both.keep,
    reason: `Dev ${first.scores}, measured again on new seeds: ${both.scores}, ${both.detail}`,
  };
}
