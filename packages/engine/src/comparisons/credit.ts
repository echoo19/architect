import type { ComparisonEngine } from './engine';
import type { ComparisonFiles } from './records';

/** A run's hosted student spending, split at its locked test. */
interface RunSpend {
  development: number;
  developmentAttempts: number;
  test: number;
  testAttempts: number;
}

/**
 * The student's hosted credit as a comparison has used it, read from the records each time it is
 * asked: every dollar the sweeps and the arms' runs paid, and the price an attempt actually cost,
 * overall and in each run, whose harness sets how much it reads. The runner holds the plan to the
 * credit with these numbers rather than with the calibration's price alone.
 */
export class Credit {
  constructor(
    private readonly engine: ComparisonEngine,
    private readonly files: ComparisonFiles,
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
      const test = attempt.split === 'test';
      if (test) spend.test += cost.usd ?? 0;
      else spend.development += cost.usd ?? 0;
      if (counted.has(attempt.id)) continue;
      counted.add(attempt.id);
      if (test) spend.testAttempts += 1;
      else spend.developmentAttempts += 1;
    }
    return spend;
  }

  /** The runs of the comparison's arms. */
  private runs() {
    return this.engine.store.runs.list().filter((run) => run.protocol?.arm !== undefined);
  }

  /** What the calibration and regression sweeps paid. */
  private sweeps(): number {
    return [...this.files.readSweep('calibration'), ...this.files.readSweep('regression')].reduce(
      (sum, attempt) => sum + (attempt.usd ?? 0),
      0,
    );
  }

  /** Every hosted dollar paid so far: the sweeps and every arm's runs, tests and repeats. */
  paid(): number {
    return this.runs().reduce((sum, run) => {
      const spend = this.spendOf(run.run.id);
      return sum + spend.development + spend.test;
    }, this.sweeps());
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
    const spend = this.spendOf(runId);
    const attempts = spend.developmentAttempts + spend.testAttempts;
    return attempts === 0 ? this.price() : (spend.development + spend.test) / attempts;
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
