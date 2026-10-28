import type { Job, LineageEntry, Prediction, Round, Score } from '@architect/shared';
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

/** "16 more", "3 fewer", "no more": a change in passes, after a number has been given. */
function changePhrase(gain: number): string {
  if (gain > 0) return `${gain} more`;
  if (gain < 0) return `${-gain} fewer`;
  return 'no more';
}

function capitalized(sentence: string): string {
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
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
  const { devBefore: before, devAfter: after, decision, firstMeasurement } = round;
  if (!before || !after || !decision) return null;
  if (firstMeasurement) {
    return measuredTwice(firstMeasurement, { before, after, decision }, lineage, job);
  }
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

/**
 * A change that cleared the keep limits once and was measured again on new seeds: what the first
 * measurement found, then the totals over both, which decided it against limits for twice the
 * runs (decision 022).
 */
function measuredTwice(
  first: NonNullable<Round['firstMeasurement']>,
  both: { before: Score; after: Score; decision: NonNullable<Round['decision']> },
  lineage: LineageEntry | undefined,
  job: Job,
): string {
  const runs = 2 * job.evaluation.devRepeats;
  const margin = job.evaluation.minDevGain * runs;
  const allowed = job.evaluation.maxTypeRegression * runs;
  const firstGain = first.devAfter.pass - first.devBefore.pass;
  const gain = both.after.pass - both.before.pass;
  const opening =
    `${gainPhrase(firstGain)} on the first measurement ` +
    `(${first.devBefore.pass} to ${first.devAfter.pass} of ${first.devAfter.total})`;
  const again =
    `Run a second time to rule out luck: ${changePhrase(gain)} over both measurements ` +
    `(${both.before.pass} to ${both.after.pass} of ${both.after.total})`;
  const worst = worstLoss(lineage, job);

  if (both.decision === 'kept') {
    const guard =
      lineage && worst.lost === 0 ? 'no task type got worse' : lossRule(allowed, 'lost');
    return `${opening}. ${again}, and ${guard}.`;
  }
  if (gain < margin) {
    return `${opening}. ${again}. A change needs at least ${inWords(margin)} more over both to stay.`;
  }
  if (worst.lost > allowed) {
    const rule = capitalized(lossRule(allowed, 'may lose'));
    return `${opening}. ${again}, but ${worst.label} lost ${inWords(worst.lost)}. ${rule}.`;
  }
  return `${opening}. ${again}.`;
}

/**
 * How a measured change compares with the mentor's predicted range, as a sentence. The
 * prediction is for one measurement, so a change measured twice is compared on its first.
 */
export function predictionCheck(
  predicted: Prediction,
  measured: number,
  mentor: string,
  subject = 'The result',
): string {
  if (measured < predicted.devDeltaMin) {
    return `${subject} fell short of ${mentor}'s predicted range.`;
  }
  if (measured > predicted.devDeltaMax) return `${subject} beat ${mentor}'s predicted range.`;
  return `${subject} was inside ${mentor}'s predicted range.`;
}
