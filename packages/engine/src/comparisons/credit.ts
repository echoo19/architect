import type { ComparisonEngine } from './engine';
import type { StudentCredit } from './spend';

/** A run's hosted student spending, split at its locked test. */
interface RunSpend {
  development: number;
  developmentAttempts: number;
  test: number;
  testAttempts: number;
}

/**
 * The student's hosted credit as a comparison has used it. What was paid comes from the request
 * journal: every request, the sweeps' and the arms', with a charge a crash or a failure left
 * uncertain at its worst case. What an attempt costs, overall and in each run, comes from the
 * runs' records, where each call is what the provider billed or else its listed price. The
 * runner holds the plan to the credit with these numbers rather than with calibration's alone.
 */
export class Credit {
  constructor(
    private readonly engine: ComparisonEngine,
    private readonly journal: StudentCredit,
    /** What calibration measured an attempt to cost, before any arm has paid for one. */
    private readonly calibrationPrice: number,
  ) {}

  private spendOf(runId: string): RunSpend {
    const { store } = this.engine;
    const attempts = new Map(
      store.attempts.list({ runId }).map((attempt) => [attempt.id, attempt]),
    );
    const spend: RunSpend = { development: 0, developmentAttempts: 0, test: 0, testAttempts: 0 };
    const counted = new Set<string>();
    for (const cost of store.costs.list(runId)) {
      if (cost.role !== 'student' || cost.attemptId === null) continue;
      const attempt = attempts.get(cost.attemptId);
      // Attempts on this computer cost nothing and would only dilute the hosted price.
      if (attempt === undefined || attempt.target !== 'hosted') continue;
      if (cost.usd === null) {
        // The runner checks the hosted student's price before anything spends; a cost it can't
        // know must stop the holds rather than count as nothing.
        throw new Error(
          `Attempt ${attempt.id} of run ${runId} has no known cost, so the student's credit can't be held.`,
        );
      }
      const test = attempt.split === 'test';
      if (test) spend.test += cost.usd;
      else spend.development += cost.usd;
      if (counted.has(attempt.id)) continue;
      counted.add(attempt.id);
      if (test) spend.testAttempts += 1;
      else spend.developmentAttempts += 1;
    }
    return spend;
  }

  /**
   * The runs of the comparison's arms whose attempts the student makes: the teacher arm's are the
   * teacher's, at another price, so they are left out of the student's (decision 096).
   */
  private runs() {
    return this.engine.store.runs
      .list()
      .filter((run) => run.protocol?.arm !== undefined && run.protocol.arm !== 'teacher');
  }

  /**
   * Every hosted dollar paid so far, by the journal: the sweeps and every arm's runs, tests and
   * repeats, with each uncertain charge at its worst and every request in flight held at its worst.
   */
  paid(): number {
    return this.journal.total();
  }

  /** What a hosted attempt has cost on average so far; calibration's price before any arm. */
  price(): number {
    let usd = 0;
    let attempts = 0;
    for (const run of this.runs()) {
      const spend = this.spendOf(run.run.id);
      usd += spend.development + spend.test;
      attempts += spend.developmentAttempts + spend.testAttempts;
    }
    return attempts === 0 ? this.calibrationPrice : usd / attempts;
  }

  /** What a hosted attempt of one run has cost on average; the overall price when it has none. */
  priceOf(runId: string): number {
    return this.ownPrice(runId) ?? this.price();
  }

  /** What a hosted attempt of one run has cost on average; null before it has made one. */
  ownPrice(runId: string): number | null {
    const spend = this.spendOf(runId);
    const attempts = spend.developmentAttempts + spend.testAttempts;
    return attempts === 0 ? null : (spend.development + spend.test) / attempts;
  }

  /**
   * What one run's locked-test attempts have cost on average: what its repeat, the same tasks
   * under another seed, will cost. Its overall price when it has taken no test yet.
   */
  testPriceOf(runId: string): number {
    const spend = this.spendOf(runId);
    return spend.testAttempts === 0 ? this.priceOf(runId) : spend.test / spend.testAttempts;
  }

  /** One run's hosted dollars outside its locked test. */
  development(runId: string): number {
    return this.spendOf(runId).development;
  }
}
