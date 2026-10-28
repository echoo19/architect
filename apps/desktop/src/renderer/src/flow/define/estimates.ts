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
  /** The starting check, which runs the check tasks once before the first round. */
  startSeconds: number;
  /** Training alone: the starting check and the round budget, or the time cap when it binds. */
  trainingSeconds: Span;
  /** Rounds that fit in the time cap: if every round needs a second check, and if none does. */
  rounds: { fewest: number; most: number };
  /** One round: a practice batch and two check runs, or four when its change is checked again. */
  roundSeconds: Span;
}

/**
 * How long training takes at a place. The starting version takes the check tasks once; then every
 * round attempts a practice batch and runs the check tasks for the current version and the
 * change, once per repeat. A change that clears the keep limits has both run again on new seeds
 * (decision 022), so a round runs the check tasks two or four times. All of it stops at the time
 * cap. The locked test is separate: it runs afterwards on this computer (decision 009), outside
 * the cap, and `testSeconds` times it.
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
    return `No full round fits in ${cap} of training: the starting check takes ${formatDuration(estimate.startSeconds * 1000)} here, then a round at least ${formatDuration(estimate.roundSeconds.least * 1000)}`;
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

/** What the three simpler versions add to the bills, each in the dollars of whoever bills it. */
export interface ComparisonCost {
  /** Practice on the hosted copy for the version that revises itself; null when it trains here. */
  hostedUsd: number | null;
  /** One call to the mentor for the instructions it writes in one go; null without a price. */
  mentorUsd: number | null;
}

export function comparisonCost(
  job: Job,
  estimate: TimeEstimate,
  hostedPricing: TokenPricing | null | undefined,
): ComparisonCost {
  const preset = mentorPresetOf(job);
  return {
    hostedUsd:
      job.student.trainOn === 'hosted' && hostedPricing
        ? practiceUsd(hostedPricing, estimate)
        : null,
    mentorUsd: preset ? mentorUsdFor(preset.pricing, 1) : null,
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
  // Under ten hours a half hour still matters: 60 tasks at 2.5 minutes are 2.5 hours, not 3.
  if (hours < 10) return `About ${Math.round(hours * 2) / 2} hours`;
  if (hours < 36) return `About ${Math.round(hours)} hours`;
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
