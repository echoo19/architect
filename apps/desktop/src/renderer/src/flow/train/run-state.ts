import type {
  Attempt,
  BudgetState,
  Job,
  LineageEntry,
  Round,
  Run,
  RunDetail,
  RunEvent,
  RunImprovement,
} from '@architect/shared';

/** An attempt as the training view lists it, with the request text when the engine sent it. */
export type RecentAttempt = Attempt & { prompt?: string };

/** How many recent attempts the view keeps in memory. */
export const RECENT_ATTEMPT_LIMIT = 40;

export interface EvalProgress {
  split: 'dev' | 'test';
  done: number;
  total: number;
}

export interface RunNotice {
  level: 'warn' | 'error';
  message: string;
}

/** Everything the training view shows, rebuilt from a snapshot and the events after it. */
export interface LiveRun {
  run: Run;
  job: Job;
  /** Ascending by round number. */
  rounds: Round[];
  /** Newest first, practice (train) and check (dev) attempts only. */
  attempts: RecentAttempt[];
  lineage: LineageEntry[];
  budget: BudgetState | null;
  progress: EvalProgress | null;
  mentorBusy: boolean;
  /** The latest warning or error the engine logged in the current phase. */
  notice: RunNotice | null;
  graduateId: string | null;
  /**
   * Set when the run is Improve agent's: it ends in a new version of that agent, scored on the
   * check tasks, and takes no final test.
   */
  improves: RunImprovement | null;
}

export type LiveRunState =
  | { status: 'loading'; pending: RunEvent[] }
  | { status: 'error'; error: Error; pending: RunEvent[] }
  | { status: 'live'; live: LiveRun };

export type LiveRunAction =
  | { type: 'loading' }
  | { type: 'snapshot'; detail: RunDetail }
  | { type: 'event'; event: RunEvent }
  | { type: 'failed'; error: Error };

export const initialLiveRunState: LiveRunState = { status: 'loading', pending: [] };

/**
 * Events can arrive before the snapshot does, so they wait in `pending` and are replayed on top
 * of it. Replaying is safe because every event either carries a newer copy of something (guarded
 * so an older copy never wins) or adds something identified by id.
 */
export function liveRunReducer(state: LiveRunState, action: LiveRunAction): LiveRunState {
  switch (action.type) {
    case 'loading':
      return { status: 'loading', pending: state.status === 'live' ? [] : state.pending };
    case 'failed':
      return state.status === 'live'
        ? state
        : { status: 'error', error: action.error, pending: state.pending };
    case 'snapshot': {
      const pending = state.status === 'live' ? [] : state.pending;
      return { status: 'live', live: pending.reduce(applyRunEvent, fromDetail(action.detail)) };
    }
    case 'event':
      return state.status === 'live'
        ? { status: 'live', live: applyRunEvent(state.live, action.event) }
        : { ...state, pending: [...state.pending, action.event] };
  }
}

function fromDetail(detail: RunDetail): LiveRun {
  return {
    run: detail.run,
    job: detail.job,
    rounds: [...detail.rounds].sort((a, b) => a.index - b.index),
    attempts: keepRecent(detail.recentAttempts.filter(isListed)),
    lineage: detail.lineage,
    budget: null,
    progress: null,
    mentorBusy: false,
    notice: null,
    graduateId: detail.run.graduateId ?? null,
    improves: detail.improves ?? null,
  };
}

function applyRunEvent(live: LiveRun, event: RunEvent): LiveRun {
  if (event.runId !== live.run.id) return live;
  switch (event.type) {
    case 'run.updated': {
      if (event.run.id !== live.run.id || isOlder(event.run, live.run)) return live;
      const phaseChanged = event.run.phase !== live.run.phase;
      return {
        ...live,
        run: event.run,
        graduateId: event.run.graduateId ?? live.graduateId,
        notice: phaseChanged ? null : live.notice,
      };
    }
    case 'round.updated':
      return { ...live, rounds: upsertRound(live.rounds, event.round) };
    case 'attempt.finished': {
      const attempt: RecentAttempt =
        event.prompt === undefined ? event.attempt : { ...event.attempt, prompt: event.prompt };
      if (!isListed(attempt) || live.attempts.some((a) => a.id === attempt.id)) return live;
      return { ...live, attempts: keepRecent([attempt, ...live.attempts]) };
    }
    case 'mentor.started':
      return { ...live, mentorBusy: true };
    case 'mentor.finished':
      return { ...live, mentorBusy: false };
    case 'eval.progress':
      return {
        ...live,
        progress: { split: event.split, done: event.done, total: event.total },
      };
    case 'eval.finished':
      return { ...live, progress: null };
    case 'budget':
      return { ...live, budget: event.state };
    case 'log':
      return event.level === 'info'
        ? live
        : { ...live, notice: { level: event.level, message: event.message } };
    case 'graduate.ready':
      return { ...live, graduateId: event.graduateId };
    case 'attempt.started':
    case 'mentoring.updated':
      return live;
  }
}

/** The locked test's attempts never appear in the list, and neither do calibration runs. */
function isListed(attempt: Attempt): boolean {
  return attempt.split === 'train' || attempt.split === 'dev';
}

function keepRecent(attempts: RecentAttempt[]): RecentAttempt[] {
  return attempts.slice(0, RECENT_ATTEMPT_LIMIT);
}

function isOlder(candidate: Run, current: Run): boolean {
  return Date.parse(candidate.updatedAt) < Date.parse(current.updatedAt);
}

const ROUND_PROGRESS: Record<Round['status'], number> = {
  attempting: 0,
  diagnosing: 1,
  clarifying: 2,
  teaching: 2,
  training: 3,
  evaluating: 4,
  decided: 5,
  failed: 5,
};

/** A round only moves forward: a late copy from an earlier step never replaces a later one. */
function upsertRound(rounds: Round[], next: Round): Round[] {
  const existing = rounds.find((round) => round.index === next.index);
  if (!existing) return [...rounds, next].sort((a, b) => a.index - b.index);
  if (ROUND_PROGRESS[next.status] < ROUND_PROGRESS[existing.status]) return rounds;
  return rounds.map((round) => (round.index === next.index ? next : round));
}

/* Selectors */

export function currentRound(live: LiveRun): Round | null {
  return live.rounds.at(-1) ?? null;
}

/** The newest practice task the student got wrong in a round. */
export function latestFailure(live: LiveRun, round: number): RecentAttempt | null {
  return (
    live.attempts.find(
      (attempt) => attempt.split === 'train' && attempt.round === round && !attempt.check.pass,
    ) ?? null
  );
}

export function roundAttempts(live: LiveRun, round: number): RecentAttempt[] {
  return live.attempts.filter((attempt) => attempt.split === 'train' && attempt.round === round);
}

/** Median answer time of the most recent attempts, or null before the first one. */
export function medianLatencyMs(attempts: readonly Attempt[], sample = 20): number | null {
  const times = attempts
    .slice(0, sample)
    .map((attempt) => attempt.latencyMs)
    .sort((a, b) => a - b);
  if (times.length === 0) return null;
  const middle = Math.floor(times.length / 2);
  return times.length % 2 === 1
    ? (times[middle] ?? 0)
    : ((times[middle - 1] ?? 0) + (times[middle] ?? 0)) / 2;
}

export function changeCounts(rounds: readonly Round[]): { kept: number; tried: number } {
  const decided = rounds.filter((round) => round.decision !== undefined);
  return {
    kept: decided.filter((round) => round.decision === 'kept').length,
    tried: decided.length,
  };
}

export function hasKeptChange(rounds: readonly Round[]): boolean {
  return rounds.some((round) => round.decision === 'kept');
}

export interface BudgetMeters {
  minutes: { used: number; max: number };
  usd: { used: number; max: number };
  rounds: { used: number; max: number };
}

/** The engine's own budget report when it has sent one, else the run's totals against the job. */
export function budgetMeters(live: LiveRun): BudgetMeters {
  if (live.budget) return live.budget;
  const { totals } = live.run;
  const { budget } = live.job;
  return {
    minutes: { used: totals.wallMs / 60_000, max: budget.maxWallMinutes },
    usd: { used: totals.mentorUsd, max: budget.maxMentorUsd },
    rounds: { used: totals.rounds, max: budget.maxRounds },
  };
}

/** Evaluation progress that belongs to what the run is doing now. */
export function activeProgress(live: LiveRun): EvalProgress | null {
  const { progress, run } = live;
  if (!progress) return null;
  const testing = run.phase === 'testing' || run.status === 'testing';
  if (progress.split === 'test') return testing ? progress : null;
  return run.phase === 'evaluating' || run.phase === 'baseline' ? progress : null;
}
