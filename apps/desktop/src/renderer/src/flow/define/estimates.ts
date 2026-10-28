import { formatDuration } from '../../lib/format';
import {
  costUsd,
  MENTOR_PRESETS,
  type Job,
  type MentorPreset,
  type TokenPricing,
} from '@architect/shared';

/**
 * Rough seconds per task: Glimmer on this machine takes 2 to 3 minutes per task (measured
 * 2026-10-27, docs/PROGRESS.md); a hosted copy is about ten times faster.
 */
export const SECONDS_PER_TASK = { local: 150, hosted: 15 } as const;

/**
 * Rough size of one diagnosis: the mentor reads a batch of failing traces and the harness, then
 * writes one change set with its reasoning.
 */
export const MENTOR_TOKENS_PER_ROUND = { inputTokens: 30_000, outputTokens: 5_000 } as const;

export type TrainPlace = 'local' | 'hosted';

/** The shortest and the longest a stretch of time can be, in seconds. */
export interface Span {
  least: number;
  most: number;
}

export interface TimeEstimate {
  /** The starting measurement: the check tasks, scored once before the first round. */
  startSeconds: number;
  /** Training alone: the starting measurement and the round budget, or the cap when it binds. */
  trainingSeconds: Span;
  /** Rounds that fit in the time cap: if every round is measured again, and if none is. */
  rounds: { fewest: number; most: number };
  /** One round: a practice batch and two measurements, or four when its change is measured again. */
  roundSeconds: Span;
}

/**
 * How long training takes at a place. The starting version is measured on the check tasks once;
 * then every round attempts a practice batch and measures the current version and the change on
 * the check tasks, once per repeat. A change that clears the keep limits has both measured again
 * on new seeds (decision 022), so a round measures twice or four times. All of it stops at the
 * time cap. The locked test is separate: it runs afterwards on this computer (decision 009),
 * outside the cap, and `testSeconds` times it.
 */
export function estimateTime(job: Job, place: TrainPlace): TimeEstimate {
  const perTask = SECONDS_PER_TASK[place];
  const checkRun = job.splits.dev * job.evaluation.devRepeats * perTask;
  const practice = job.evaluation.trainBatch * perTask;
  const round = { least: practice + 2 * checkRun, most: practice + 4 * checkRun };
  const { maxRounds } = job.budget;
  const capSeconds = job.budget.maxWallMinutes * 60;
  const fit = (perRound: number) =>
    Math.max(0, Math.min(maxRounds, Math.floor((capSeconds - checkRun) / perRound)));
  const training = (perRound: number) => Math.min(checkRun + maxRounds * perRound, capSeconds);
  return {
    startSeconds: checkRun,
    trainingSeconds: { least: training(round.least), most: training(round.most) },
    rounds: { fewest: fit(round.most), most: fit(round.least) },
    roundSeconds: round,
  };
}

/** The locked test, which always runs on this computer, whatever trained the agent. */
export function testSeconds(job: Job): number {
  return job.splits.test * SECONDS_PER_TASK.local;
}

/** A time cap as a number and its unit: 240 is 4 hours, 90 is 90 minutes, 150 is 2.5 hours. */
function capAmount(minutes: number): { amount: string; unit: 'hour' | 'minute' } {
  if (minutes % 60 === 0) return { amount: String(minutes / 60), unit: 'hour' };
  if (minutes < 120) return { amount: String(minutes), unit: 'minute' };
  return { amount: (minutes / 60).toFixed(1), unit: 'hour' };
}

/** A time cap as people say it: "4 hours", "90 minutes", "2.5 hours". */
export function capText(minutes: number): string {
  const { amount, unit } = capAmount(minutes);
  return `${amount} ${unit}${amount === '1' ? '' : 's'}`;
}

/** The same cap as a name for the limit: "4-hour", "90-minute", "2.5-hour". */
export function limitText(minutes: number): string {
  const { amount, unit } = capAmount(minutes);
  return `${amount}-${unit}`;
}

function roundCount(count: number): string {
  return `${count} ${count === 1 ? 'round' : 'rounds'}`;
}

/** "5 to 10", "at most 1", "none" or "7": how many rounds fit, said plainly. */
function countRange({ fewest, most }: TimeEstimate['rounds']): string {
  if (most === 0) return 'none';
  if (fewest === most) return String(most);
  if (fewest === 0) return `at most ${most}`;
  return `${fewest} to ${most}`;
}

/** How much training fits at a place, as a fact: the rounds that fit in the time cap. */
export function roundsLine(job: Job, estimate: TimeEstimate): string {
  const { maxRounds, maxWallMinutes } = job.budget;
  const cap = capText(maxWallMinutes);
  const { fewest, most } = estimate.rounds;
  if (fewest >= maxRounds) {
    return `All ${roundCount(maxRounds)} fit, in ${aboutSpan(estimate.trainingSeconds).toLowerCase()} of training`;
  }
  if (most === 0) {
    return `No full round fits in ${cap} of training: the starting measurement takes ${formatDuration(estimate.startSeconds * 1000)} here, then a round at least ${formatDuration(estimate.roundSeconds.least * 1000)}`;
  }
  const verb = most === 1 ? 'fits' : 'fit';
  const count = countRange(estimate.rounds);
  return `${count.charAt(0).toUpperCase()}${count.slice(1)} of ${roundCount(maxRounds)} ${verb} in ${cap} of training`;
}

/** How long one task takes at a place, as people say it: "about 2.5 minutes", "about 15 seconds". */
export function taskTimeText(place: TrainPlace): string {
  const seconds = SECONDS_PER_TASK[place];
  if (seconds < 60) return `about ${seconds} seconds`;
  const minutes = seconds / 60;
  return `about ${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} minutes`;
}

/** Why a place can't train in the time limit, or null when at least one round fits. */
export function tooSlow(job: Job, estimate: TimeEstimate): string | null {
  if (estimate.rounds.most > 0) return null;
  const limit = `${limitText(job.budget.maxWallMinutes)} limit`;
  const first = formatDuration((estimate.startSeconds + estimate.roundSeconds.least) * 1000);
  return `Too slow: the first round would end after about ${first}, past the ${limit}. Raise the limit in Advanced settings to train here.`;
}

/**
 * What training alone takes at a place, apart from the final test and the comparison runs: its
 * time, and what the time limit does to it.
 */
export function trainingSummary(job: Job, estimate: TimeEstimate, place: string): string {
  const { maxRounds, maxWallMinutes } = job.budget;
  const limit = `${limitText(maxWallMinutes)} limit`;
  const { fewest, most } = estimate.rounds;
  if (most === 0) {
    return `No full round fits in the ${limit} on ${place}, so no change could be kept.`;
  }
  const time = `${aboutSpan(estimate.trainingSeconds)} on ${place}`;
  if (fewest >= maxRounds) return `${time}, within the ${limit}.`;
  return `${time}. The ${limit} ends it after ${countRange(estimate.rounds)} rounds.`;
}

/** The final test on its own: its time, where it runs and what it is made of. */
export function finalTestSummary(job: Job, place: string): string {
  return `${formatAbout(testSeconds(job))} on ${place}, on ${job.splits.test} tasks it has never seen.`;
}

/** Rough size of one task for the student: the request, its tool results and an answer. */
export const STUDENT_TOKENS_PER_TASK = { inputTokens: 9_000, outputTokens: 400 } as const;

/** What practice on a hosted copy usually costs at its price, billed by the host. */
export function practiceUsd(pricing: TokenPricing, estimate: TimeEstimate): number {
  const tasks = estimate.trainingSeconds.most / SECONDS_PER_TASK.hosted;
  return tasks * costUsd(pricing, STUDENT_TOKENS_PER_TASK);
}

/** The practice the host bills for one training run, or null when it trains here or has no price. */
function hostedPracticeUsd(
  job: Job,
  estimate: TimeEstimate,
  hostedPricing: TokenPricing | null | undefined,
): number | null {
  return job.student.trainOn === 'hosted' && hostedPricing
    ? practiceUsd(hostedPricing, estimate)
    : null;
}

/** Training time a typical job uses up: its four-hour time limit. */
const TYPICAL_TRAINING_SECONDS = 4 * 3600;

/** What practice on a hosted copy usually costs for one agent, before there is a job to price. */
export function typicalPracticeUsd(pricing: TokenPricing): number {
  const tasks = TYPICAL_TRAINING_SECONDS / SECONDS_PER_TASK.hosted;
  return tasks * costUsd(pricing, STUDENT_TOKENS_PER_TASK);
}

/** What the three simpler versions add: a final test each, and self-correction's own training. */
export function comparisonSeconds(job: Job, estimate: TimeEstimate): number {
  return 3 * testSeconds(job) + estimate.trainingSeconds.most;
}

/** Dollars by whoever bills them; each is null when that bill has no price. */
export interface Bills {
  /** Practice on the hosted copy; null when it trains here. */
  hostedUsd: number | null;
  /** The mentor's calls. */
  mentorUsd: number | null;
}

/**
 * What the three simpler versions add to the bills: the hosted practice for the version that
 * revises itself, and one call to the mentor for the instructions it writes in one go.
 */
export function comparisonCost(
  job: Job,
  estimate: TimeEstimate,
  hostedPricing: TokenPricing | null | undefined,
): Bills {
  const preset = mentorPresetOf(job);
  return {
    hostedUsd: hostedPracticeUsd(job, estimate, hostedPricing),
    mentorUsd: preset ? mentorUsdFor(preset.pricing, 1) : null,
  };
}

/** Training, the final test and, when asked for, the comparison runs, for the "In all" line. */
export function planSeconds(job: Job, estimate: TimeEstimate, withComparison: boolean): Span {
  const after = testSeconds(job) + (withComparison ? comparisonSeconds(job, estimate) : 0);
  return {
    least: estimate.trainingSeconds.least + after,
    most: estimate.trainingSeconds.most + after,
  };
}

/** The sum of the amounts that have a price, or null when none does. */
function sumKnown(amounts: readonly (number | null)[]): number | null {
  const known = amounts.filter((amount): amount is number => amount !== null);
  return known.length === 0 ? null : known.reduce((total, amount) => total + amount, 0);
}

/**
 * The money in the plan, by who bills it: the hosted practice, and the mentor's expected spend,
 * which can't come to more than its cap. `total` adds the comparison runs when asked for;
 * `comparison` is their share alone.
 */
export function planBills(
  job: Job,
  estimate: TimeEstimate,
  hostedPricing: TokenPricing | null | undefined,
  withComparison: boolean,
): { total: Bills; comparison: Bills } {
  const comparison = comparisonCost(job, estimate, hostedPricing);
  const expected = expectedMentorUsd(job, estimate);
  const own: Bills = {
    hostedUsd: hostedPracticeUsd(job, estimate, hostedPricing),
    mentorUsd: expected === null ? null : Math.min(expected, job.budget.maxMentorUsd),
  };
  if (!withComparison) return { total: own, comparison };
  return {
    total: {
      hostedUsd: sumKnown([own.hostedUsd, comparison.hostedUsd]),
      mentorUsd: sumKnown([own.mentorUsd, comparison.mentorUsd]),
    },
    comparison,
  };
}

/** The same money as two sums: what the agent's own training costs, and what the comparison adds. */
export function planUsd(
  job: Job,
  estimate: TimeEstimate,
  hostedPricing: TokenPricing | null | undefined,
): { own: number | null; comparison: number | null } {
  const { total, comparison } = planBills(job, estimate, hostedPricing, false);
  return {
    own: sumKnown([total.hostedUsd, total.mentorUsd]),
    comparison: sumKnown([comparison.hostedUsd, comparison.mentorUsd]),
  };
}

/** "About 40 minutes", "About 2.5 hours", "About 12 hours", "About 2 days". */
export function formatAbout(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes < 1) return 'Under a minute';
  if (minutes < 55) {
    const rounded = Math.max(5, Math.round(minutes / 5) * 5);
    return `About ${rounded} minutes`;
  }
  const hours = minutes / 60;
  if (hours < 1.5) return 'About 1 hour';
  // A half hour still matters: 60 tasks at 2.5 minutes are 2.5 hours, not 3, and the parts of
  // the "In all" line should add up to its total.
  if (hours < 36) return `About ${Math.round(hours * 2) / 2} hours`;
  return `About ${Math.round(hours / 24)} days`;
}

/**
 * A span the way people say it, in the unit of its longer end: "About 4 hours", "About 4 to 7
 * hours", "About 20 to 45 minutes". Ends that round to the same words say it once.
 */
export function aboutSpan({ least, most }: Span): string {
  const low = formatAbout(least);
  const high = formatAbout(most);
  if (low === high) return high;
  const minutes = most / 60;
  if (minutes < 55) {
    const step = (seconds: number) => Math.max(5, Math.round(seconds / 300) * 5);
    return `About ${step(least)} to ${step(most)} minutes`;
  }
  const [unit, size] = minutes / 60 < 36 ? (['hours', 3600] as const) : (['days', 86_400] as const);
  const lower = Math.max(1, Math.round(least / size));
  const upper = Math.round(most / size);
  return lower === upper ? high : `About ${lower} to ${upper} ${unit}`;
}

/** The preset a job's mentor came from, matched by endpoint and model. */
export function mentorPresetOf(job: Job): MentorPreset | null {
  const { mentor } = job;
  if (mentor.kind !== 'model') return null;
  return (
    MENTOR_PRESETS.find(
      (preset) => preset.model === mentor.model && preset.baseUrl === mentor.baseUrl,
    ) ?? null
  );
}

/** A typical round budget, for pricing a mentor before there is a job to price it for. */
export const TYPICAL_ROUNDS = 12;

/** What a mentor at this price usually costs over a number of rounds. */
export function mentorUsdFor(pricing: TokenPricing, rounds: number): number {
  return rounds * costUsd(pricing, MENTOR_TOKENS_PER_ROUND);
}

/** What the mentor usually costs over the whole round budget, or null if its price is unknown. */
export function estimateMentorUsd(job: Job): number | null {
  const preset = mentorPresetOf(job);
  if (!preset) return null;
  return mentorUsdFor(preset.pricing, job.budget.maxRounds);
}

/** The rounds the mentor is paid for: those that fit in the time limit, else the whole budget. */
export function mentorRounds(job: Job, estimate: TimeEstimate): number {
  const { maxRounds } = job.budget;
  return estimate.rounds.most > 0 ? Math.min(estimate.rounds.most, maxRounds) : maxRounds;
}

/** What the mentor is expected to cost over those rounds, or null if its price is unknown. */
export function expectedMentorUsd(job: Job, estimate: TimeEstimate): number | null {
  const usual = estimateMentorUsd(job);
  return usual === null ? null : (usual / job.budget.maxRounds) * mentorRounds(job, estimate);
}

/** "$0.05", "$0.70", "$4.50", "$18": precise enough for an estimate, never falsely exact. */
export function formatAboutUsd(amount: number): string {
  if (amount < 0.01) return 'under $0.01';
  if (amount < 0.1) return `$${amount.toFixed(2)}`;
  if (amount < 1) return `$${(Math.round(amount * 20) / 20).toFixed(2)}`;
  if (amount < 10) {
    const halves = Math.round(amount * 2) / 2;
    return Number.isInteger(halves) ? `$${halves}` : `$${halves.toFixed(2)}`;
  }
  return `$${Math.round(amount)}`;
}

/** An estimate that starts a sentence: "About $0.70", "Under $0.10". */
export function aboutUsd(amount: number): string {
  const rough = formatAboutUsd(amount);
  return rough.startsWith('under') ? `Under ${rough.slice('under '.length)}` : `About ${rough}`;
}
