import type { EvaluationConfig, Score, TypeScore } from '@architect/shared';
import { compareText } from './seeds';

export interface KeepInput {
  /** Dev score of the incumbent (the last kept version), measured again for this comparison. */
  before: Score;
  /** Dev score of the candidate, on the same dev tasks and seeds. Both add up every repeat. */
  after: Score;
  beforePerType: TypeScore[];
  afterPerType: TypeScore[];
  evaluation: Pick<EvaluationConfig, 'minDevGain' | 'maxTypeRegression' | 'devRepeats'>;
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

/**
 * Keep a change only if net dev passes rise by at least the margin and no task type loses more
 * than the allowed number of passes (decision 007). Scores add up every repeat, so both limits
 * scale with the repeat count. Anything else is reverted.
 */
export function decideKeep(input: KeepInput): KeepDecision {
  const { before, after, evaluation } = input;
  const repeats = evaluation.devRepeats;
  const margin = evaluation.minDevGain * repeats;
  const allowedLoss = evaluation.maxTypeRegression * repeats;
  const runs = repeats === 1 ? '' : ` over ${repeats} runs`;
  const head = `Dev ${formatScore(before)} → ${formatScore(after)}${runs}`;
  const gain = after.pass - before.pass;

  if (gain < margin) {
    const shortfall =
      gain === 0 ? 'no change' : gain < 0 ? `down ${-gain}` : `short of the +${margin} margin`;
    return { keep: false, reason: `${head}, ${shortfall}` };
  }

  const worst = worstTypeLoss(input.beforePerType, input.afterPerType);
  if (worst !== null && worst.lost > allowedLoss) {
    const passes = worst.lost === 1 ? 'pass' : 'passes';
    return { keep: false, reason: `${head}, but ${worst.type} lost ${worst.lost} ${passes}` };
  }

  const guard =
    allowedLoss === 0 ? 'no type lost a pass' : `no type lost more than ${inWords(allowedLoss)}`;
  return { keep: true, reason: `${head}, ${guard}` };
}
