import type { Policy } from './policy';

/**
 * The arithmetic of a screening plate, on the true wells before any export wrote them: percent
 * inhibition against the plate's own controls, Z′, the hit threshold, and each compound's call.
 * The tasks' expected values come from here. The reference works the same rules out again from
 * the exports themselves, in the code it sends to `run` (src/reference/code.ts).
 */

export interface WellValue {
  /** The well as `C5`: row letters, then the column without a leading zero. */
  well: string;
  /** The compound's id, or the policy's code for a control. */
  compound: string;
  role: 'neg' | 'pos' | 'compound';
  /** The signal as the export wrote it, or null for a well with no reading. */
  signal: number | null;
}

export function mean(values: readonly number[]): number {
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

/** The sample standard deviation (n − 1). */
export function sampleSd(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1));
}

export interface PlateStats {
  negMean: number;
  posMean: number;
  negSd: number;
  posSd: number;
  zPrime: number;
  pass: boolean;
  /** The hit threshold in percent inhibition. */
  threshold: number;
}

/** The plate's controls, its Z′, whether it passes, and its hit threshold. */
export function plateStats(wells: readonly WellValue[], policy: Policy): PlateStats {
  const signals = (role: WellValue['role']) =>
    wells.filter((w) => w.role === role && w.signal !== null).map((w) => w.signal as number);
  const neg = signals('neg');
  const pos = signals('pos');
  const negMean = mean(neg);
  const posMean = mean(pos);
  const negSd = sampleSd(neg);
  const posSd = sampleSd(pos);
  const zPrime = 1 - (3 * (posSd + negSd)) / Math.abs(posMean - negMean);
  const threshold =
    policy.hit.kind === 'percent'
      ? policy.hit.value
      : policy.hit.value * sampleSd(neg.map((x) => inhibition(x, negMean, posMean)));
  return { negMean, posMean, negSd, posSd, zPrime, pass: zPrime >= policy.zMin, threshold };
}

export function inhibition(signal: number, negMean: number, posMean: number): number {
  return (100 * (negMean - signal)) / (negMean - posMean);
}

export type Call = 'hit' | 'inactive' | 'inconclusive';

export interface CompoundCall {
  compound: string;
  wells: string[];
  /** Percent inhibition of the wells with a reading, in well order. */
  values: number[];
  /** Their mean, or null when no well has a reading. */
  mean: number | null;
  /** Every well has a reading and they differ by no more than the policy allows. */
  agree: boolean;
  call: Call;
  borderline: boolean;
}

/** Each compound of a plate, called by the policy, in the order its first well comes. */
export function compoundCalls(
  wells: readonly WellValue[],
  stats: PlateStats,
  policy: Policy,
): CompoundCall[] {
  const groups = new Map<string, WellValue[]>();
  for (const well of wells) {
    if (well.role !== 'compound') continue;
    groups.set(well.compound, [...(groups.get(well.compound) ?? []), well]);
  }
  return [...groups].map(([compound, group]) => {
    const values = group
      .filter((w) => w.signal !== null)
      .map((w) => inhibition(w.signal as number, stats.negMean, stats.posMean));
    const m = values.length === 0 ? null : mean(values);
    const spread = values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
    const agree = values.length === group.length && spread <= policy.agree;
    const reaches =
      policy.rule === 'mean'
        ? m !== null && m >= stats.threshold
        : values.every((v) => v >= stats.threshold);
    const call: Call = !agree ? 'inconclusive' : reaches ? 'hit' : 'inactive';
    const borderline =
      call !== 'inconclusive' && m !== null && Math.abs(m - stats.threshold) < policy.band;
    return { compound, wells: group.map((w) => w.well), values, mean: m, agree, call, borderline };
  });
}

export interface RetestRequest {
  plate: string;
  /** Null for the whole plate. */
  compound: string | null;
  reason: string;
}

export interface PlateCalls {
  stats: PlateStats;
  compounds: CompoundCall[];
  /** The compounds called hits; none on a plate that fails. */
  hits: string[];
}

export function plateCalls(wells: readonly WellValue[], policy: Policy): PlateCalls {
  const stats = plateStats(wells, policy);
  const compounds = compoundCalls(wells, stats, policy);
  const hits = stats.pass ? compounds.filter((c) => c.call === 'hit').map((c) => c.compound) : [];
  return { stats, compounds, hits };
}

/**
 * What a plate needs re-tested by the policy, leaving out what the queue already holds for it:
 * the whole plate when it fails, else its inconclusive and borderline compounds, of which the
 * policy takes at most `cap`.
 */
export function retestNeeds(
  plate: string,
  calls: PlateCalls,
  policy: Policy,
  queued: readonly RetestRequest[],
): { whole: boolean; candidates: RetestRequest[]; take: number } {
  const held = queued.filter((r) => r.plate === plate);
  if (!calls.stats.pass) {
    const whole = !held.some((r) => r.compound === null);
    return { whole, candidates: [], take: 0 };
  }
  const candidates = calls.compounds
    .filter((c) => c.call === 'inconclusive' || c.borderline)
    .filter((c) => !held.some((r) => r.compound === c.compound))
    .map((c) => ({
      plate,
      compound: c.compound,
      reason: c.call === 'inconclusive' ? policy.codes.inconclusive : policy.codes.borderline,
    }));
  return { whole: false, candidates, take: Math.min(policy.cap, candidates.length) };
}
