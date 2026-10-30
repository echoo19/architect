import { describe, expect, it } from 'vitest';
import {
  answeredNeeded,
  betaQuantile,
  chooseThreshold,
  clopperPearsonUpper,
  incompleteBeta,
  riskCoverage,
  type Scored,
} from '../src/certify/stats';

/** P(X <= x) for X ~ Binomial(n, p), summed term by term in logs. */
function binomialCdf(x: number, n: number, p: number): number {
  let logChoose = 0;
  let sum = 0;
  for (let i = 0; i <= x; i += 1) {
    if (i > 0) logChoose += Math.log(n - i + 1) - Math.log(i);
    sum += Math.exp(logChoose + i * Math.log(p) + (n - i) * Math.log(1 - p));
  }
  return sum;
}

function items(spec: readonly [votes: number, correct: boolean, count: number][]): Scored[] {
  return spec.flatMap(([votes, correct, count]) =>
    Array.from({ length: count }, () => ({ votes, correct })),
  );
}

describe('the incomplete beta function', () => {
  it('matches closed forms', () => {
    // Beta(a, 1) has CDF x^a; Beta(1, b) has CDF 1 - (1 - x)^b; Beta(1, 1) is uniform.
    expect(incompleteBeta(0.3, 4, 1)).toBeCloseTo(0.3 ** 4, 12);
    expect(incompleteBeta(0.2, 1, 7)).toBeCloseTo(1 - 0.8 ** 7, 12);
    expect(incompleteBeta(0.42, 1, 1)).toBeCloseTo(0.42, 12);
    // Symmetry: I_x(a, b) = 1 - I_{1-x}(b, a).
    expect(incompleteBeta(0.37, 5.5, 2.25)).toBeCloseTo(1 - incompleteBeta(0.63, 2.25, 5.5), 12);
  });

  it('inverts to its quantile', () => {
    for (const [p, a, b] of [
      [0.95, 6, 95],
      [0.5, 3, 3],
      [0.99, 1, 200],
      [0.9, 13, 188],
    ] as const) {
      expect(incompleteBeta(betaQuantile(p, a, b), a, b)).toBeCloseTo(p, 10);
    }
  });
});

describe('the Clopper-Pearson upper bound', () => {
  it('has the closed form with no errors: 1 - δ^(1/n)', () => {
    expect(clopperPearsonUpper(0, 10, 0.05)).toBeCloseTo(1 - 0.05 ** (1 / 10), 10);
    expect(clopperPearsonUpper(0, 10, 0.05)).toBeCloseTo(0.2589, 4);
    expect(clopperPearsonUpper(0, 30, 0.05)).toBeCloseTo(0.095, 4);
    expect(clopperPearsonUpper(0, 59, 0.05)).toBeLessThan(0.05);
    expect(clopperPearsonUpper(0, 58, 0.05)).toBeGreaterThan(0.05);
  });

  it('has the closed form with one success: (1 - δ)^(1/n)', () => {
    expect(clopperPearsonUpper(9, 10, 0.05)).toBeCloseTo(0.95 ** (1 / 10), 10);
  });

  it('is the rate at which seeing that few errors has probability δ', () => {
    for (const [errors, n, delta] of [
      [5, 100, 0.05],
      [2, 50, 0.05],
      [12, 200, 0.1],
      [1, 8, 0.01],
      [30, 40, 0.05],
    ] as const) {
      const bound = clopperPearsonUpper(errors, n, delta);
      expect(binomialCdf(errors, n, bound)).toBeCloseTo(delta, 9);
      expect(bound).toBeGreaterThan(errors / n);
    }
  });

  it('bounds nothing without observations or when all are errors', () => {
    expect(clopperPearsonUpper(0, 0, 0.05)).toBe(1);
    expect(clopperPearsonUpper(3, 3, 0.05)).toBe(1);
  });

  it('refuses counts and levels that are not ones', () => {
    expect(() => clopperPearsonUpper(4, 3, 0.05)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(1.5, 3, 0.05)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(0, 3, 0)).toThrow(RangeError);
  });
});

describe('the risk-coverage curve', () => {
  it('runs from strictest to loosest, coverage rising', () => {
    const data = items([
      [5, true, 40],
      [4, true, 20],
      [4, false, 2],
      [3, false, 6],
      [2, true, 4],
    ]);
    const curve = riskCoverage(data, 5, 0.05);
    expect(curve.map((point) => point.votes)).toEqual([5, 4, 3, 2, 1]);
    expect(curve.map((point) => point.answered)).toEqual([40, 62, 68, 72, 72]);
    expect(curve.map((point) => point.errors)).toEqual([0, 2, 8, 8, 8]);
    expect(curve[0]?.risk).toBe(0);
    expect(curve[4]?.coverage).toBe(1);
  });

  it('answers nothing when every task falls short of the threshold', () => {
    const curve = riskCoverage(items([[2, true, 10]]), 5, 0.05);
    expect(curve[0]).toMatchObject({ answered: 0, coverage: 0, risk: null, bound: 1 });
  });
});

describe('fixed-sequence threshold selection', () => {
  const target = { k: 5, epsilon: 0.1, delta: 0.05 };

  it('certifies the loosest threshold before the first failure', () => {
    const data = items([
      [5, true, 60],
      [4, true, 20],
      [4, false, 1],
      [3, false, 10],
      [2, true, 9],
    ]);
    const choice = chooseThreshold(data, target);
    expect(choice.certified).toBe(true);
    if (!choice.certified) return;
    expect(choice.point.votes).toBe(4);
    expect(choice.point.bound).toBeLessThanOrEqual(0.1);
    expect(choice.point.answered).toBe(81);
    expect(choice.point.coverage).toBeCloseTo(0.81, 10);
  });

  it('stops at the first failure even when a looser threshold would pass', () => {
    // 3 of 5 fails; 2 of 5 adds many correct tasks and would pass on its own.
    const data = items([
      [5, true, 60],
      [3, false, 8],
      [2, true, 400],
    ]);
    const choice = chooseThreshold(data, target);
    expect(choice.certified).toBe(true);
    if (!choice.certified) return;
    expect(choice.point.votes).toBe(4);
    const loosest = choice.curve.find((point) => point.votes === 2);
    expect(loosest?.bound).toBeLessThanOrEqual(0.1);
  });

  it('with no errors, certifies answering everything once n is large enough', () => {
    const choice = chooseThreshold(items([[5, true, 30]]), { k: 5, epsilon: 0.1, delta: 0.05 });
    expect(choice.certified && choice.point.votes).toBe(1);
  });

  it('says how many tasks would do when n is small', () => {
    const choice = chooseThreshold(items([[5, true, 10]]), target);
    expect(choice).toMatchObject({ certified: false, reason: 'too_few' });
    if (choice.certified) return;
    // Zero errors meets 10% at 95% once n reaches 29.
    expect(choice.needed).toBe(29);
  });

  it('counts the needed tasks before abstentions', () => {
    const choice = chooseThreshold(
      items([
        [5, true, 10],
        [1, true, 10],
      ]),
      target,
    );
    if (choice.certified) throw new Error('certified');
    // Half are answered at the strictest threshold, so twice as many tasks.
    expect(choice.needed).toBe(58);
  });

  it('gives no count when every task abstains', () => {
    expect(chooseThreshold(items([[2, true, 50]]), target)).toMatchObject({
      certified: false,
      reason: 'none_answered',
      needed: null,
    });
  });

  it('gives no count when the error rate is above the target', () => {
    expect(
      chooseThreshold(
        items([
          [5, false, 3],
          [5, true, 7],
        ]),
        target,
      ),
    ).toMatchObject({
      certified: false,
      reason: 'error_rate',
      needed: null,
    });
  });

  it('with k = 1 is a plain bound at full coverage', () => {
    const choice = chooseThreshold(
      items([
        [1, true, 57],
        [1, false, 3],
      ]),
      {
        k: 1,
        epsilon: 0.15,
        delta: 0.05,
      },
    );
    expect(choice.certified).toBe(true);
    if (!choice.certified) return;
    expect(choice.point.coverage).toBe(1);
    expect(choice.point.bound).toBeCloseTo(clopperPearsonUpper(3, 60, 0.05), 12);
  });

  it('handles an empty calibration set', () => {
    expect(chooseThreshold([], target)).toMatchObject({
      certified: false,
      reason: 'none_answered',
    });
  });
});

describe('answered tasks needed', () => {
  it('is the smallest n whose bound meets the target', () => {
    const n = answeredNeeded(0, 0.05, 0.05) as number;
    expect(clopperPearsonUpper(0, n, 0.05)).toBeLessThanOrEqual(0.05);
    expect(clopperPearsonUpper(0, n - 1, 0.05)).toBeGreaterThan(0.05);
    expect(n).toBe(59);
  });

  it('is null when the rate sits too close to the target', () => {
    expect(answeredNeeded(0.0999999, 0.1, 0.05)).toBeNull();
  });
});
