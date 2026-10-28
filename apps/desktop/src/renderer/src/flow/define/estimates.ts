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
  /** Training plus the final test. */
  seconds: Span;
  /** Training alone: the starting check and the round budget, or the time cap when it binds. */
  trainingSeconds: Span;
  /** Rounds that fit in the time cap: if every round needs a second check, and if none does. */
  rounds: { fewest: number; most: number };
  /** One round: a practice batch and two check runs, or four when its change is checked again. */
  roundSeconds: Span;
}

/**
 * How long a run takes from Start to report card. The starting version takes the check tasks
 * once; then every round attempts a practice batch and runs the check tasks for the current
 * version and the change, once per repeat. A change that clears the keep limits has both run
 * again on new seeds (decision 022), so a round runs the check tasks two or four times. All of
 * it stops at the time cap; then the locked test runs on this computer (decision 009).
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
  const trainingSeconds = { least: training(round.least), most: training(round.most) };
  const test = testSeconds(job);
  return {
    seconds: { least: trainingSeconds.least + test, most: trainingSeconds.most + test },
    trainingSeconds,
    rounds: { fewest: fit(round.most), most: fit(round.least) },
    roundSeconds: round,
  };
}

/** The locked test, which always runs on this computer, whatever trained the agent. */
export function testSeconds(job: Job): number {
  return job.splits.test * SECONDS_PER_TASK.local;
}

/** A time cap as people say it: "4 hours", "90 minutes", "2.5 hours". */
export function capText(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  if (minutes < 120) return `${minutes} minutes`;
  return `${(minutes / 60).toFixed(1)} hours`;
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
    return `No full round fits in ${cap} of training: one takes at least ${formatDuration(estimate.roundSeconds.least * 1000)} here`;
  }
  const verb = most === 1 ? 'fits' : 'fit';
  const count = countRange(estimate.rounds);
  return `${count.charAt(0).toUpperCase()}${count.slice(1)} of ${roundCount(maxRounds)} ${verb} in ${cap} of training`;
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

/** The three simpler versions: a final test each, and self-correction's own training. */
export function comparisonSeconds(job: Job, estimate: TimeEstimate): number {
  return 3 * testSeconds(job) + estimate.trainingSeconds.most;
}

/** The whole run: training, the final test and, when asked for, the simpler versions. */
export function runSeconds(job: Job, estimate: TimeEstimate, withComparison: boolean): Span {
  const after = testSeconds(job) + (withComparison ? comparisonSeconds(job, estimate) : 0);
  return {
    least: estimate.trainingSeconds.least + after,
    most: estimate.trainingSeconds.most + after,
  };
}

/** "About 40 minutes", "About 3 hours", "About 2 days". */
export function formatAbout(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes < 1) return 'Under a minute';
  if (minutes < 55) {
    const rounded = Math.max(5, Math.round(minutes / 5) * 5);
    return `About ${rounded} minutes`;
  }
  const hours = minutes / 60;
  if (hours < 1.5) return 'About 1 hour';
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
