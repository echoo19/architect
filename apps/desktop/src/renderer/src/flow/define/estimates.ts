import { formatDuration, formatUsd } from '../../lib/format';
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

/** The rounds that fit at a place, to sit beside its time: "5 to 10 rounds", "All 12 rounds". */
export function fittingRounds(job: Job, estimate: TimeEstimate): string {
  const { maxRounds } = job.budget;
  const { fewest, most } = estimate.rounds;
  if (fewest >= maxRounds) return `All ${roundCount(maxRounds)}`;
  const count = countRange(estimate.rounds);
  const rounds = most === 1 ? 'round' : 'rounds';
  return `${count.charAt(0).toUpperCase()}${count.slice(1)} ${rounds}`;
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
  return `Too slow for the ${limitText(job.budget.maxWallMinutes)} limit`;
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
 * The bills as they are shown, added up, so a total matches the figures listed above it; null
 * when none has a price.
 */
export function shownTotalUsd(bills: Bills): number | null {
  const shown = [bills.hostedUsd, bills.mentorUsd].map((amount) =>
    amount === null ? null : roughUsd(amount),
  );
  return sumKnown(shown);
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

/** A rough length of time, rounded the way a person would say it; null is under a minute. */
function roughDuration(
  seconds: number,
): { amount: number; unit: 'minute' | 'hour' | 'day' } | null {
  const minutes = seconds / 60;
  if (minutes < 1) return null;
  if (minutes < 55) return { amount: Math.max(5, Math.round(minutes / 5) * 5), unit: 'minute' };
  const hours = minutes / 60;
  if (hours < 1.5) return { amount: 1, unit: 'hour' };
  // A half hour still matters: 60 tasks at 2.5 minutes are 2.5 hours, not 3, and the parts of a
  // plan should add up to its total.
  if (hours < 36) return { amount: Math.round(hours * 2) / 2, unit: 'hour' };
  return { amount: Math.round(hours / 24), unit: 'day' };
}

/** "About 40 minutes", "About 2.5 hours", "About 12 hours", "About 2 days". */
export function formatAbout(seconds: number): string {
  const rough = roughDuration(seconds);
  if (!rough) return 'Under a minute';
  const plural = rough.amount === 1 ? '' : 's';
  return `About ${rough.amount} ${rough.unit}${plural}`;
}

const SHORT_UNITS = { minute: 'min', hour: 'h', day: 'days' } as const;

/** The same rounding in a column of figures: "40 min", "2.5 h", "2 days", "<1 min". */
export function shortDuration(seconds: number): string {
  const rough = roughDuration(seconds);
  if (!rough) return '<1 min';
  if (rough.unit === 'day' && rough.amount === 1) return '1 day';
  return `${rough.amount} ${SHORT_UNITS[rough.unit]}`;
}

/** A span in a column of figures: "4 h", "4–7 h", "20–45 min". Ends that round alike show once. */
export function shortSpan(span: Span): string {
  const low = shortDuration(span.least);
  const high = shortDuration(span.most);
  if (low === high) return high;
  const [lowAmount, lowUnit] = low.split(' ');
  const [highAmount, highUnit] = high.split(' ');
  return lowUnit === highUnit ? `${lowAmount}–${highAmount} ${highUnit}` : `${low} to ${high}`;
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

/** An estimate rounded as `formatAboutUsd` shows it; under a cent counts as nothing. */
export function roughUsd(amount: number): number {
  if (amount < 0.01) return 0;
  if (amount < 0.1) return Math.round(amount * 100) / 100;
  if (amount < 1) return Math.round(amount * 20) / 20;
  if (amount < 10) return Math.round(amount * 2) / 2;
  return Math.round(amount);
}

/** "$0.05", "$0.70", "$4.50", "$18": precise enough for an estimate, never falsely exact. */
export function formatAboutUsd(amount: number): string {
  return amount < 0.01 ? 'under $0.01' : formatUsd(roughUsd(amount));
}

/** An estimate that starts a sentence: "About $0.70", "Under $0.10". */
export function aboutUsd(amount: number): string {
  const rough = formatAboutUsd(amount);
  return rough.startsWith('under') ? `Under ${rough.slice('under '.length)}` : `About ${rough}`;
}
