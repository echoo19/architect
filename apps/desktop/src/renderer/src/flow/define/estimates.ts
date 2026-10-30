import { formatDuration, formatUsd } from '../../lib/format';
import { mentorIsLocal } from '../../lib/names';
import {
  allowedInterventions,
  ATTEMPT_TOKENS,
  costUsd,
  MENTOR_PRESETS,
  mentorPricing,
  SECONDS_PER_ATTEMPT,
  type Job,
  type MentorPreset,
  type TokenPricing,
} from '@architect/shared';
import type { ModelNames } from '../train/phase';

/**
 * Rough seconds per task: Glimmer on this machine takes 2 to 3 minutes per task (measured
 * 2026-10-27, docs/PROGRESS.md); a hosted copy is about ten times faster.
 */
export const SECONDS_PER_TASK = SECONDS_PER_ATTEMPT;

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
 * time cap. The final test is separate: it runs afterwards, on this computer unless the person
 * chose the online copy (decision 009), outside the cap, and `testSeconds` times it.
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

/**
 * The final test, on this computer unless the run takes it on the online copy. Where it runs
 * doesn't depend on what trained the agent.
 */
export function testSeconds(job: Job, place: TrainPlace = 'local'): number {
  return finalTestAttempts(job) * SECONDS_PER_TASK[place];
}

/**
 * The calibration tasks a certificate is planned with before the tasks are split: the size the
 * job sets, else the least the default takes when there are that many (decision 077).
 */
export const PLANNED_CALIBRATION = 30;

/** The calibration tasks a certified job sets aside, or the planned size when it doesn't say. */
export function calibrationTasks(job: Job): number {
  const certify = job.evaluation.certify;
  return certify === undefined ? 0 : (certify.calibration ?? PLANNED_CALIBRATION);
}

/**
 * The attempts the final test makes: one at each task, and for a certified job k at each final
 * test and calibration task (decision 077).
 */
export function finalTestAttempts(job: Job): number {
  const certify = job.evaluation.certify;
  if (certify === undefined) return job.splits.test;
  return certify.k * (job.splits.test + calibrationTasks(job));
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

/** Where training happens, as the middle of a sentence: "online", or "on this computer". */
export function placePhrase(place: TrainPlace, device: string): string {
  return place === 'hosted' ? 'online' : `on ${device}`;
}

/**
 * What the note under the choice says about what leaves this computer when training here. Training
 * always sends the teacher its view of the practice attempts (`DataSharingSchema`), so "nothing
 * leaves" is only true when the teacher runs on this computer as well. Any other teacher, a coding
 * agent included, is online, and the line says what goes there.
 */
export function trainHereLine(job: Job, names: ModelNames, device: string): string {
  return mentorIsLocal(job.mentor)
    ? `Nothing leaves ${device}.`
    : `Only what ${names.mentor} reads to teach goes online.`;
}

/** What the note says when training happens online: the host gets the tasks and the files. */
export const TRAIN_ONLINE_LINE = 'Tasks and files go online.';

/** Where the teacher works, as the start of a sentence about what it sees. */
export function teacherWorks(job: Job, device: string): string {
  return mentorIsLocal(job.mentor) ? `runs on ${device}` : 'works in the cloud';
}

export interface EstimateNotesInput {
  names: ModelNames;
  /** This computer as the middle of a sentence ("this Mac") and as the start of one ("This Mac"). */
  device: { inSentence: string; label: string };
  local: TimeEstimate;
  /** The online copy's estimate, when there is a copy to train on. */
  remote: TimeEstimate | null;
  /** Whether the three simpler versions are offered, which the notes then explain. */
  baselines: boolean;
}

/**
 * What the estimate assumes, one line each, for whoever wants to know: when training stops, how
 * many rounds fit at each place, what is measured twice, what the teacher sees, and what has a
 * hard cap.
 */
export function estimateNotes(job: Job, input: EstimateNotesInput): string[] {
  const { names, device, local, remote, baselines } = input;
  const { maxRounds, maxWallMinutes } = job.budget;
  const { mentor, student } = names;
  return [
    `Training stops at the ${Math.round(job.requirements.passRate * 100)}% target, after ${maxRounds} rounds or after ${capText(maxWallMinutes)}, or sooner once changes stop helping. Paused time doesn't count.`,
    `${device.label}: ${roundsLine(job, local)}.`,
    ...(remote === null ? [] : [`Online: ${roundsLine(job, remote)}.`]),
    'A promising change is measured twice, so its round takes longer.',
    `${mentor} ${teacherWorks(job, device.inSentence)} and sees the practice attempts and the file samples it needs.`,
    ...(baselines
      ? [
          `The three simpler versions are ${student} on its own, a setup ${mentor} writes in one go, and ${student} revising its own. They run after this agent.`,
        ]
      : []),
    `Only ${mentor}'s bill has a hard cap.`,
  ];
}

/**
 * Whether the place the job trains at can't fit a single round in the time limit. The run would
 * score the student on the check tasks and then run out of time, with nothing taught.
 */
export function trainsTooSlow(job: Job): boolean {
  return tooSlow(job, estimateTime(job, job.student.trainOn)) !== null;
}

/** The longest a job may train for: a week, as the job's own limit allows. */
const MOST_MINUTES = 10_080;

/**
 * The time limit, in whole hours, that lets a place fit one round even when its change is
 * measured again: what the callout offers when not one round fits, so a click on it is sure to
 * let the teacher teach. Null when not even a week would.
 */
export function minutesForOneRound(job: Job, place: TrainPlace): number | null {
  const { startSeconds, roundSeconds } = estimateTime(job, place);
  const minutes = Math.ceil((startSeconds + roundSeconds.most) / 3600) * 60;
  return minutes <= MOST_MINUTES ? minutes : null;
}

/**
 * Training with every round at its longest, as if there were no time limit: what the limit is
 * measured against, so a meter can show when the limit cuts training short.
 */
export function fullTrainingSeconds(job: Job, estimate: TimeEstimate): number {
  return estimate.startSeconds + job.budget.maxRounds * estimate.roundSeconds.most;
}

/** The time limit, in whole hours, that fits every round at its longest; null past a week. */
export function minutesForAllRounds(job: Job, place: TrainPlace): number | null {
  const minutes = Math.ceil(fullTrainingSeconds(job, estimateTime(job, place)) / 3600) * 60;
  return minutes <= MOST_MINUTES ? minutes : null;
}

/** A cap the plan doesn't fit in, said plainly, and the fix. */
export interface CapShortfall {
  what: 'time' | 'compute';
  /** A few words for beside Start training. */
  short: string;
  /** The whole of it, for the Budget tab. */
  line: string;
  /** For the time limit: the limit that fits every round. */
  allowMinutes?: number;
}

/**
 * Where the caps can't hold what the job asks for: a time limit that cuts training to fewer than
 * half its rounds even at best (training often ends early at its target, so a limit that only
 * trims the last few rounds is normal; one where not even a round fits is the callout's, not
 * this), and retraining the student turned on with no compute to spend on it. Empty when the
 * caps hold the plan.
 */
export function capShortfalls(job: Job, names: ModelNames): CapShortfall[] {
  const shortfalls: CapShortfall[] = [];
  const place = job.student.trainOn;
  const estimate = estimateTime(job, place);
  const { maxRounds, maxWallMinutes } = job.budget;
  if (estimate.rounds.most > 0 && estimate.rounds.most < maxRounds / 2) {
    const all = minutesForAllRounds(job, place);
    const fit = `${countRange(estimate.rounds)} of ${maxRounds} rounds`;
    shortfalls.push({
      what: 'time',
      short: `The ${limitText(maxWallMinutes)} limit fits ${fit}`,
      line: `The ${limitText(maxWallMinutes)} time limit may stop training after ${fit}.${
        all === null ? '' : ` Allowing ${capText(all)} fits all of them.`
      }`,
      ...(all === null ? {} : { allowMinutes: all }),
    });
  }
  if (allowedInterventions(job).includes('weights') && (job.budget.maxComputeUsd ?? 0) <= 0) {
    shortfalls.push({
      what: 'compute',
      short: `Retraining ${names.student} has a $0 cap`,
      line: `Retraining ${names.student} is on, but its compute cap is $0, so it won't run. Set a cap below, or turn it off in Teaching.`,
    });
  }
  return shortfalls;
}

/**
 * What it comes to, in a line: the callout's headline, and what the footer says beside a Start
 * training that waits for it. A round is one go at teaching, so not one fitting is plain to say.
 */
export function wontTeachTitle(job: Job, place: TrainPlace, device: string): string {
  return `Not even one round of teaching fits in ${capText(job.budget.maxWallMinutes)} ${placePhrase(place, device)}`;
}

/**
 * What the button that sets a longer time limit gives: the limit it sets is the one
 * `minutesForOneRound` found, so one round does fit in it, the longest it can take included. A
 * round is called a round of teaching throughout the callout, as its title does.
 */
export function allowingLine(minutes: number): string {
  return `Allowing ${capText(minutes)} leaves room for one round of teaching.`;
}

/** A length of time to the minute, which the person can add up: "1 h 40 min", "23 min". */
function toTheMinute(seconds: number): string {
  return formatDuration(seconds * 1000);
}

/**
 * The figures behind the callout's title, for a place where not one round fits the time limit: the
 * starting measurement and a round, from the shortest it takes to the longest, which is the one the
 * button's limit is made from, so the figures add up to it. The times are to the minute, since two
 * figures rounded to the half hour can add up to the limit that the title says they pass.
 */
export function wontTeachBody(job: Job, estimate: TimeEstimate): string {
  const start = `Scoring the check tasks once takes about ${toTheMinute(estimate.startSeconds)}`;
  if (estimate.startSeconds >= job.budget.maxWallMinutes * 60) return `${start}.`;
  const { least, most } = estimate.roundSeconds;
  const round =
    least === most ? toTheMinute(least) : `${toTheMinute(least)} to ${toTheMinute(most)}`;
  return `${start}, then ${round} for each round of teaching.`;
}

/** Rough size of one task for the student: the request, its tool results and an answer. */
export const STUDENT_TOKENS_PER_TASK = ATTEMPT_TOKENS;

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
export function comparisonSeconds(
  job: Job,
  estimate: TimeEstimate,
  testPlace: TrainPlace = 'local',
): number {
  return 3 * testSeconds(job, testPlace) + estimate.trainingSeconds.most;
}

/** What the final test costs on a hosted copy at its price, billed by the host. */
export function testUsd(job: Job, pricing: TokenPricing): number {
  return finalTestAttempts(job) * costUsd(pricing, STUDENT_TOKENS_PER_TASK);
}

/** `tests` final tests on the hosted copy, or null when they run here or the copy has no price. */
function hostedTestUsd(
  job: Job,
  hostedPricing: TokenPricing | null | undefined,
  testPlace: TrainPlace,
  tests: number,
): number | null {
  return testPlace === 'hosted' && hostedPricing ? tests * testUsd(job, hostedPricing) : null;
}

/** Dollars by whoever bills them; each is null when that bill has no price. */
export interface Bills {
  /** Practice on the hosted copy; null when it trains here. */
  hostedUsd: number | null;
  /** The final test on the hosted copy; null when it runs here. */
  testUsd: number | null;
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
  testPlace: TrainPlace = 'local',
): Bills {
  const pricing = mentorPriceOf(job);
  return {
    hostedUsd: hostedPracticeUsd(job, estimate, hostedPricing),
    testUsd: hostedTestUsd(job, hostedPricing, testPlace, 3),
    mentorUsd: pricing ? mentorUsdFor(pricing, 1) : null,
  };
}

/** Training, the final test and, when asked for, the comparison runs, for the "In all" line. */
export function planSeconds(
  job: Job,
  estimate: TimeEstimate,
  withComparison: boolean,
  testPlace: TrainPlace = 'local',
): Span {
  const after =
    testSeconds(job, testPlace) +
    (withComparison ? comparisonSeconds(job, estimate, testPlace) : 0);
  return {
    least: estimate.trainingSeconds.least + after,
    most: estimate.trainingSeconds.most + after,
  };
}

/** The sum of the amounts that have a price, or null when none does. */
export function sumKnown(amounts: readonly (number | null)[]): number | null {
  const known = amounts.filter((amount): amount is number => amount !== null);
  return known.length === 0 ? null : known.reduce((total, amount) => total + amount, 0);
}

/**
 * The bills as they are shown, added up, so a total matches the figures listed above it; null
 * when none has a price.
 */
export function shownTotalUsd(bills: Bills): number | null {
  const shown = [bills.hostedUsd, bills.testUsd, bills.mentorUsd].map((amount) =>
    amount === null ? null : roughUsd(amount),
  );
  return sumKnown(shown);
}

/**
 * The money in the plan, by who bills it: the hosted practice, the final test when it is taken on
 * the hosted copy, and the mentor's expected spend, which can't come to more than its cap.
 * `total` adds the comparison runs when asked for; `comparison` is their share alone.
 */
export function planBills(
  job: Job,
  estimate: TimeEstimate,
  hostedPricing: TokenPricing | null | undefined,
  withComparison: boolean,
  testPlace: TrainPlace = 'local',
): { total: Bills; comparison: Bills } {
  const comparison = comparisonCost(job, estimate, hostedPricing, testPlace);
  const expected = expectedMentorUsd(job, estimate);
  const own: Bills = {
    hostedUsd: hostedPracticeUsd(job, estimate, hostedPricing),
    testUsd: hostedTestUsd(job, hostedPricing, testPlace, 1),
    mentorUsd: expected === null ? null : Math.min(expected, job.budget.maxMentorUsd),
  };
  if (!withComparison) return { total: own, comparison };
  return {
    total: {
      hostedUsd: sumKnown([own.hostedUsd, comparison.hostedUsd]),
      testUsd: sumKnown([own.testUsd, comparison.testUsd]),
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
  const pricing = mentorPriceOf(job);
  return pricing ? mentorUsdFor(pricing, job.budget.maxRounds) : null;
}

/**
 * What the job's mentor costs per token: the price saved with it, its preset's, or nothing for a
 * model on this computer. Null when the price is unknown (decision 034).
 */
export function mentorPriceOf(job: Job): TokenPricing | null {
  return job.mentor.kind === 'model' ? (mentorPricing(job.mentor) ?? null) : null;
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
