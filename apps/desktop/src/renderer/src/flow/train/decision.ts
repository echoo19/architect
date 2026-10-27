import type { Job, LineageEntry, Prediction, Round } from '@architect/shared';
import { typeLabel } from '../names';

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

/** Small counts in words, as people write them in a sentence: "more than one". */
function inWords(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/** "8 more check tasks passed", "1 fewer check task passed". */
function gainPhrase(gain: number): string {
  const count = Math.abs(gain);
  const noun = `check ${count === 1 ? 'task' : 'tasks'}`;
  if (gain > 0) return `${count} more ${noun} passed`;
  if (gain < 0) return `${count} fewer ${noun} passed`;
  return 'The same number of check tasks passed';
}

/** The rule that protects each task type, as a clause: "no task type lost more than one". */
function lossRule(allowed: number, tense: 'lost' | 'may lose'): string {
  if (allowed === 0) {
    return tense === 'lost' ? 'no task type got worse' : 'no task type may get worse';
  }
  return `no task type ${tense} more than ${inWords(allowed)}`;
}

/** The task type that lost the most check-task passes, by its label. */
function worstLoss(lineage: LineageEntry | undefined, job: Job): { label: string; lost: number } {
  let worst = { label: '', lost: 0 };
  for (const type of lineage?.measured.perType ?? []) {
    const lost = type.before - type.after;
    if (lost > worst.lost) worst = { label: typeLabel(job, type.type), lost };
  }
  return worst;
}

/**
 * Why a decided round was kept or reverted, in one plain sentence, from the scores the runner
 * measured and the job's rules. Null while the round is still being decided.
 */
export function decisionSentence(
  round: Round,
  lineage: LineageEntry | undefined,
  job: Job,
): string | null {
  const { devBefore: before, devAfter: after, decision } = round;
  if (!before || !after || !decision) return null;
  const repeats = job.evaluation.devRepeats;
  const margin = job.evaluation.minDevGain * repeats;
  const allowed = job.evaluation.maxTypeRegression * repeats;
  const gain = after.pass - before.pass;
  const runs = repeats > 1 ? `, adding up ${repeats} runs` : '';
  const measured = `${gainPhrase(gain)} (${before.pass} to ${after.pass} of ${after.total}${runs})`;
  const worst = worstLoss(lineage, job);

  if (decision === 'kept') {
    const guard =
      lineage && worst.lost === 0 ? 'no task type got worse' : lossRule(allowed, 'lost');
    return `${measured}, and ${guard}.`;
  }
  if (gain < margin) {
    return `${measured}. A change needs at least ${inWords(margin)} more to stay.`;
  }
  if (worst.lost > allowed) {
    const rule = lossRule(allowed, 'may lose');
    return `${measured}, but ${worst.label} lost ${inWords(worst.lost)}. ${rule.charAt(0).toUpperCase()}${rule.slice(1)}.`;
  }
  return `${measured}.`;
}

/** How the measured change compares with the mentor's predicted range, as a sentence. */
export function predictionCheck(predicted: Prediction, measured: number, mentor: string): string {
  if (measured < predicted.devDeltaMin) {
    return `The result fell short of ${mentor}'s predicted range.`;
  }
  if (measured > predicted.devDeltaMax) return `The result beat ${mentor}'s predicted range.`;
  return `The result was inside ${mentor}'s predicted range.`;
}
