import { GuardError, type Budget, type BudgetState } from '@architect/shared';
import type { Clock } from './deps';

export interface BudgetUsage {
  rounds: number;
  usd: number;
  /** Active wall time spent in earlier sessions of the run. */
  wallMs: number;
}

export interface BudgetLeft {
  rounds: number;
  usd: number;
  minutes: number;
}

/** Slack for floating-point sums, so a call that exactly fills the cap may still start. */
const USD_EPSILON = 1e-9;

export function formatUsd(usd: number): string {
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/**
 * Hard caps on rounds, mentor dollars and wall clock. Wall time counts only while the run is
 * active: paused time, and time the app was closed, don't count.
 */
export class BudgetGuard {
  private rounds: number;
  private usd: number;
  private wallMsBefore: number;
  private activeSince: number | null = null;
  /** A deadline fired. Timers can fire a moment before the clock reads the cap. */
  private outOfTime = false;

  constructor(
    private readonly budget: Budget,
    used: BudgetUsage,
    private readonly clock: Clock,
  ) {
    this.rounds = used.rounds;
    this.usd = used.usd;
    this.wallMsBefore = used.wallMs;
  }

  /** Starts counting wall time. */
  resume(): void {
    if (this.activeSince === null) this.activeSince = this.clock.now();
  }

  /** Stops counting wall time until the next `resume`. */
  pause(): void {
    if (this.activeSince === null) return;
    this.wallMsBefore += this.clock.now() - this.activeSince;
    this.activeSince = null;
  }

  wallMs(): number {
    const running = this.activeSince === null ? 0 : this.clock.now() - this.activeSince;
    return this.wallMsBefore + running;
  }

  wallClockSpent(): boolean {
    return this.outOfTime || this.wallMs() >= this.budget.maxWallMinutes * 60_000;
  }

  /**
   * Aborts when the wall-clock budget runs out, counting from now while the run stays active.
   * From then on the wall clock counts as spent, so a cut attempt and the planner agree.
   */
  deadline(): AbortSignal {
    const signal = this.clock.timeout(this.budget.maxWallMinutes * 60_000 - this.wallMs());
    const expire = () => {
      this.outOfTime = true;
    };
    if (signal.aborted) expire();
    else signal.addEventListener('abort', expire, { once: true });
    return signal;
  }

  roundsSpent(): boolean {
    return this.rounds >= this.budget.maxRounds;
  }

  recordRound(): void {
    this.rounds += 1;
  }

  recordSpend(usd: number): void {
    this.usd += usd;
  }

  /**
   * Throws `GuardError('budget')` unless a mentor call that could cost up to `maxUsd` fits under
   * the dollar cap, and returns the authorized amount. A call whose price is unknown can't be
   * checked, so it never starts (decision 029).
   */
  authorizeMentorCall(maxUsd: number | null): number {
    if (maxUsd === null) {
      throw new GuardError(
        'budget',
        "Architect doesn't know what the mentor costs, so it can't hold training to the spending cap. Enter the model's price per million tokens beside the mentor in the job's settings, or pick a model with a known price.",
      );
    }
    const left = this.budget.maxMentorUsd - this.usd;
    if (maxUsd > left + USD_EPSILON) {
      throw new GuardError(
        'budget',
        `The next mentor call could cost up to ${formatUsd(maxUsd)}, more than the ${formatUsd(Math.max(0, left))} left in the budget.`,
      );
    }
    return maxUsd;
  }

  state(): BudgetState {
    return {
      rounds: { used: this.rounds, max: this.budget.maxRounds },
      usd: { used: this.usd, max: this.budget.maxMentorUsd },
      minutes: { used: this.wallMs() / 60_000, max: this.budget.maxWallMinutes },
    };
  }

  left(): BudgetLeft {
    return {
      rounds: Math.max(0, this.budget.maxRounds - this.rounds),
      usd: Math.max(0, this.budget.maxMentorUsd - this.usd),
      minutes: Math.max(0, this.budget.maxWallMinutes - this.wallMs() / 60_000),
    };
  }
}
