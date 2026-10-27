import { costUsd, MENTOR_PRESETS, type Job, type MentorPreset } from '@architect/shared';

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

export interface TimeEstimate {
  /** Training plus the final test, in seconds. */
  seconds: number;
  /** Rounds that fit in the time cap; equal to the round budget when the cap doesn't bind. */
  rounds: number;
}

/**
 * How long a run takes from Start to report card: every round attempts a practice batch, then
 * runs the dev split for the change and again for the current harness, once per repeat, up to
 * the time cap; then the locked test runs, always on this computer (decision 009), whatever
 * trained the harness.
 */
export function estimateTime(job: Job, place: TrainPlace): TimeEstimate {
  const checks = 2 * job.splits.dev * job.evaluation.devRepeats;
  const perRound = (job.evaluation.trainBatch + checks) * SECONDS_PER_TASK[place];
  const capSeconds = job.budget.maxWallMinutes * 60;
  const trainingSeconds = Math.min(job.budget.maxRounds * perRound, capSeconds);
  const testSeconds = job.splits.test * SECONDS_PER_TASK.local;
  const rounds = Math.min(job.budget.maxRounds, Math.floor(capSeconds / perRound));
  return { seconds: trainingSeconds + testSeconds, rounds };
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

/** What the mentor usually costs over the whole round budget, or null if its price is unknown. */
export function estimateMentorUsd(job: Job): number | null {
  const preset = mentorPresetOf(job);
  if (!preset) return null;
  return job.budget.maxRounds * costUsd(preset.pricing, MENTOR_TOKENS_PER_ROUND);
}

/** "$0.70", "$4.50", "$18": precise enough for an estimate, never falsely exact. */
export function formatAboutUsd(amount: number): string {
  if (amount < 0.1) return 'under $0.10';
  if (amount < 1) return `$${(Math.round(amount * 20) / 20).toFixed(2)}`;
  if (amount < 10) {
    const halves = Math.round(amount * 2) / 2;
    return Number.isInteger(halves) ? `$${halves}` : `$${halves.toFixed(2)}`;
  }
  return `$${Math.round(amount)}`;
}
