/**
 * The statistics behind a certificate (docs/CERTIFY.md, decision 077): an exact one-sided
 * Clopper-Pearson upper bound on an error rate, the fixed-sequence choice of the loosest
 * agreement threshold whose bound meets the target, and the risk-coverage curve. Pure functions.
 */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** The natural log of the gamma function, by Lanczos' approximation (about 15 digits). */
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let sum = 0.99999999999980993;
  LANCZOS.forEach((coefficient, index) => (sum += coefficient / (z + index + 1)));
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** The continued fraction of the incomplete beta function, by the modified Lentz method. */
function betaFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-15) break;
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b), for a, b > 0 and x in [0, 1]. */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  // The fraction converges fast on this side of the mean; the other side uses the symmetry.
  return x < (a + 1) / (a + b + 2)
    ? (front * betaFraction(x, a, b)) / a
    : 1 - (front * betaFraction(1 - x, b, a)) / b;
}

/** The p-quantile of the Beta(a, b) distribution, by bisection: I_x(a, b) rises with x. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 200 && high - low > 1e-15; i += 1) {
    const mid = (low + high) / 2;
    if (incompleteBeta(mid, a, b) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * The exact one-sided Clopper-Pearson upper bound on a rate from `errors` out of `n`, holding
 * with probability at least 1 - δ: the (1 - δ) quantile of Beta(errors + 1, n - errors). With
 * nothing observed, or every one an error, nothing is bounded: 1.
 */
export function clopperPearsonUpper(errors: number, n: number, delta: number): number {
  if (!Number.isInteger(errors) || !Number.isInteger(n) || errors < 0 || errors > n) {
    throw new RangeError(`${errors} errors out of ${n} isn't a count.`);
  }
  if (!(delta > 0 && delta < 1)) throw new RangeError(`δ must be between 0 and 1, not ${delta}.`);
  if (n === 0 || errors === n) return 1;
  return betaQuantile(1 - delta, errors + 1, n - errors);
}

/** One calibration task, as a certificate reads it: how many attempts agreed, and whether that answer was right. */
export interface Scored {
  /** Attempts whose answer is the most common one, 1 to k. */
  votes: number;
  /** The most common answer passed the checker. */
  correct: boolean;
}

/** The graduate's behavior at one threshold: answering when at least `votes` of k agree. */
export interface CurvePoint {
  votes: number;
  /** `votes / k`: the share of attempts that must agree. */
  threshold: number;
  answered: number;
  errors: number;
  /** Share of tasks answered. */
  coverage: number;
  /** Errors among answered tasks; null when none were answered. */
  risk: number | null;
  /** The Clopper-Pearson upper bound on the selective error. */
  bound: number;
}

/** Why no certificate: none answered, more errors than the target allows, or too few tasks. */
export type NoCertificateReason = 'none_answered' | 'error_rate' | 'too_few';

export type ThresholdChoice =
  | { certified: true; point: CurvePoint; curve: CurvePoint[] }
  | {
      certified: false;
      reason: NoCertificateReason;
      /** Calibration tasks that would likely be enough at the strictest threshold, when any would. */
      needed: number | null;
      curve: CurvePoint[];
    };

export interface CertifyTarget {
  /** Attempts per task. */
  k: number;
  /** The selective error the bound must not exceed. */
  epsilon: number;
  /** One minus the confidence. */
  delta: number;
}

/** The risk-coverage curve: every threshold from strictest (all k agree) to loosest (always answer). */
export function riskCoverage(items: readonly Scored[], k: number, delta: number): CurvePoint[] {
  const n = items.length;
  const curve: CurvePoint[] = [];
  for (let votes = k; votes >= 1; votes -= 1) {
    const answered = items.filter((item) => item.votes >= votes);
    const errors = answered.filter((item) => !item.correct).length;
    curve.push({
      votes,
      threshold: votes / k,
      answered: answered.length,
      errors,
      coverage: n === 0 ? 0 : answered.length / n,
      risk: answered.length === 0 ? null : errors / answered.length,
      bound: clopperPearsonUpper(errors, answered.length, delta),
    });
  }
  return curve;
}

/**
 * Learn-then-Test with fixed-sequence testing: thresholds are tested from strictest to loosest,
 * and the first whose bound exceeds ε stops the sequence. The loosest one that passed is
 * certified; none passing means no certificate, with the reason and, when more tasks would help,
 * how many.
 */
export function chooseThreshold(items: readonly Scored[], target: CertifyTarget): ThresholdChoice {
  const curve = riskCoverage(items, target.k, target.delta);
  let chosen: CurvePoint | null = null;
  for (const point of curve) {
    if (point.bound > target.epsilon) break;
    chosen = point;
  }
  if (chosen !== null) return { certified: true, point: chosen, curve };
  const strictest = curve[0] as CurvePoint;
  if (strictest.answered === 0)
    return { certified: false, reason: 'none_answered', needed: null, curve };
  const rate = strictest.errors / strictest.answered;
  if (rate >= target.epsilon)
    return { certified: false, reason: 'error_rate', needed: null, curve };
  const answered = answeredNeeded(rate, target.epsilon, target.delta);
  return {
    certified: false,
    reason: 'too_few',
    needed: answered === null ? null : Math.ceil(answered / strictest.coverage),
    curve,
  };
}

const MOST_NEEDED = 1_000_000;

/**
 * The fewest answered tasks whose bound meets ε if errors keep their observed rate, or null when
 * a million wouldn't do.
 */
export function answeredNeeded(rate: number, epsilon: number, delta: number): number | null {
  const meets = (n: number) => clopperPearsonUpper(Math.round(rate * n), n, delta) <= epsilon;
  let high = 1;
  while (!meets(high)) {
    if (high >= MOST_NEEDED) return null;
    high = Math.min(MOST_NEEDED, high * 2);
  }
  let low = Math.floor(high / 2);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (meets(mid)) high = mid;
    else low = mid;
  }
  return high;
}
