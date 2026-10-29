import {
  INTERVENTION_LABELS,
  mayIntervene,
  type Experiment,
  type Intervention,
  type Job,
  type LineageEntry,
  type Prediction,
  type Round,
  type Score,
} from '@architect/shared';
import { modelNames, typeLabel } from '../names';
import { GATES } from './evidence-words';

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

interface TypeLoss {
  label: string;
  lost: number;
  before: number;
  after: number;
}

/** The task type that lost the most check-task passes, by its label, from per-type scores. */
function worstOf(
  perType: readonly { type: string; before: number; after: number }[],
  job: Job,
): TypeLoss {
  let worst: TypeLoss = { label: '', lost: 0, before: 0, after: 0 };
  for (const type of perType) {
    const lost = type.before - type.after;
    if (lost > worst.lost) {
      worst = { label: typeLabel(job, type.type), lost, before: type.before, after: type.after };
    }
  }
  return worst;
}

function worstLoss(lineage: LineageEntry | undefined, job: Job): TypeLoss {
  return worstOf(lineage?.measured.perType ?? [], job);
}

/** "Order questions went from 3 to 0": a type's passes, so the size of the loss is plain. */
function lossPhrase(worst: TypeLoss): string {
  return `${worst.label} went from ${worst.before} to ${worst.after}`;
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
  const measured = `${gainPhrase(gain)} (${before.pass} → ${after.pass} of ${after.total}${runs})`;
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
    return `${measured}, but ${lossPhrase(worst)}. ${capitalized(rule)}.`;
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
  const opening = `${gainPhrase(firstGain)} (${first.devBefore.pass} → ${first.devAfter.pass} of ${first.devAfter.total})`;
  const again =
    `Measured again to rule out luck: ${changePhrase(gain)} over both ` +
    `(${both.before.pass} → ${both.after.pass} of ${both.after.total})`;
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
    return `${opening}. ${again}, but ${lossPhrase(worst)}. ${rule}.`;
  }
  return `${opening}. ${again}.`;
}

/**
 * Why a change that could not be tried was not, when the person turned off that kind of change
 * for the job (decision 063), said as theirs, with where to turn it on. Null when it was not their
 * choice. It looks at the job and the kind, not at the engine's sentence, and the person's choice
 * is the reason whatever else would have refused it.
 */
export function refusalSentence(intervention: Intervention | undefined, job: Job): string | null {
  if (intervention === undefined || mayIntervene(job, intervention.type)) return null;
  const { mentor } = modelNames(job);
  const kind = INTERVENTION_LABELS[intervention.type];
  return `${mentor} chose "${kind}", which is turned off for this job under Teacher in Advanced settings. Nothing changed.`;
}

/**
 * Why a measured change was rejected rather than only reverted, from its experiment: a task
 * type lost more check tasks than the job allows, or fewer passed in all. Null when the
 * experiment has no measurement to say it from.
 */
export function harmSentence(experiment: Experiment, job: Job): string | null {
  const { devBefore: before, devAfter: after } = experiment;
  if (!before || !after) return null;
  // Each dev seed is one run over the check tasks; the limit counts per run.
  const runs = Math.max(1, experiment.seeds.dev.length);
  const allowed = job.evaluation.maxTypeRegression * runs;
  const measured = `${gainPhrase(after.pass - before.pass)} (${before.pass} → ${after.pass} of ${after.total})`;
  const worst = worstOf(experiment.regressions, job);
  if (worst.lost > allowed) {
    const rule = capitalized(lossRule(allowed, 'may lose'));
    return `${measured}, and ${lossPhrase(worst)}. ${rule}.`;
  }
  return `${measured}. A change that loses check tasks is rejected.`;
}

/**
 * What a round's list line adds to its outcome, in a few words, from its experiment: what a
 * change that made things worse harmed, or the rule it broke. The other outcomes say all of it in
 * their own words, so they add nothing.
 */
export function outcomeNote(experiment: Experiment, job: Job): string | null {
  switch (experiment.disposition) {
    case 'kept':
    case 'reverted':
    case 'invalid':
    case 'stopped':
      return null;
    case 'rejected': {
      const failed = experiment.gates.find((gate) => !gate.passed);
      if (failed) return `Failed the ${GATES[failed.gate].toLowerCase()} check`;
      const runs = Math.max(1, experiment.seeds.dev.length);
      const worst = worstOf(experiment.regressions, job);
      // Short enough for a list's line, beside the round's own before and after.
      if (worst.lost > job.evaluation.maxTypeRegression * runs) {
        return `${worst.label} ${worst.before} → ${worst.after}`;
      }
      const { devBefore: before, devAfter: after } = experiment;
      if (before && after && after.pass < before.pass) return gainPhrase(after.pass - before.pass);
      return null;
    }
  }
}

/**
 * How a measured change compares with the mentor's predicted range, in a few words. The
 * prediction is for one measurement, so a change measured twice is compared on its first.
 */
export function predictionCheck(predicted: Prediction, measured: number): string {
  if (measured < predicted.devDeltaMin) return 'Measured below this range';
  if (measured > predicted.devDeltaMax) return 'Measured above this range';
  return 'Measured within this range';
}
