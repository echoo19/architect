import type { Counted } from '@architect/shared';

/** The normal quantile for a two-sided 95% interval. */
export const Z95 = 1.959963984540054;

/**
 * The Wilson score interval for `pass` successes in `total` trials, which stays inside 0 to 1 and
 * behaves at 0 and at `total`, unlike the normal approximation. Null when nothing was counted.
 */
export function wilson(pass: number, total: number, z = Z95): { low: number; high: number } | null {
  if (total <= 0) return null;
  if (pass < 0 || pass > total) throw new Error(`${pass} passes out of ${total} can't be counted.`);
  const p = pass / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** A count with its rate and 95% Wilson interval. */
export function counted(pass: number, total: number): Counted {
  return {
    pass,
    total,
    rate: total > 0 ? pass / total : null,
    wilson95: wilson(pass, total),
  };
}

export interface PairedCounts {
  /** Scenarios both arms took. */
  scenarios: number;
  aOnly: number;
  bOnly: number;
  both: number;
  neither: number;
}

/**
 * Two arms' results on the same scenarios, scenario by scenario: which only `a` passed (its
 * wins), which only `b` passed (its losses), and which both or neither did. A scenario only one
 * arm took isn't counted, so the counts always pair.
 */
export function paired(
  a: ReadonlyMap<string, boolean>,
  b: ReadonlyMap<string, boolean>,
): PairedCounts {
  const counts: PairedCounts = { scenarios: 0, aOnly: 0, bOnly: 0, both: 0, neither: 0 };
  for (const [scenario, passedA] of a) {
    const passedB = b.get(scenario);
    if (passedB === undefined) continue;
    counts.scenarios += 1;
    if (passedA && passedB) counts.both += 1;
    else if (passedA) counts.aOnly += 1;
    else if (passedB) counts.bOnly += 1;
    else counts.neither += 1;
  }
  return counts;
}

/** The difference in pass rate between two arms on the same scenarios, with its 95% interval. */
export interface PairedDifference {
  /** `a`'s pass rate less `b`'s: its wins less its losses, over every scenario both took. */
  rate: number;
  low: number;
  high: number;
}

/**
 * The difference in pass rate `a - b` between two arms on the same scenarios, with a 95% interval
 * for paired proportions: Newcombe's hybrid score method, his method 10 (Statistics in Medicine
 * 1998; 17: 2635-2650). It is made from the four paired counts alone. The Wilson score interval of
 * each arm's pass rate is combined with the correlation between the two arms' results, the phi
 * coefficient of the 2 by 2 table of wins, losses, both and neither, and method 10 takes half the
 * scenario count off phi's numerator when phi is positive. Phi is 0 when a row or column of the
 * table is empty. The interval stays within -1 and 1, and a table with no wins or losses still has
 * one, since the two pass rates are not known exactly. Null when no scenario was paired.
 */
export function pairedDifference(
  counts: Pick<PairedCounts, 'aOnly' | 'bOnly' | 'both' | 'neither'>,
  z = Z95,
): PairedDifference | null {
  // Newcombe's e, f, g and h: both pass, only a, only b, neither.
  const { both: e, aOnly: f, bOnly: g, neither: h } = counts;
  const n = e + f + g + h;
  const first = wilson(e + f, n, z);
  const second = wilson(e + g, n, z);
  if (first === null || second === null) return null;
  const rateA = (e + f) / n;
  const rateB = (e + g) / n;
  const margins = (e + f) * (g + h) * (e + g) * (f + h);
  const cross = e * h - f * g;
  const numerator = cross > 0 ? Math.max(cross - n / 2, 0) : cross;
  const phi = margins === 0 ? 0 : Math.max(-1, Math.min(1, numerator / Math.sqrt(margins)));
  // How far an end of the interval lies from the difference: the two Wilson distances on that
  // side, one for each arm, combined through phi.
  const reach = (distanceA: number, distanceB: number) =>
    Math.sqrt(
      Math.max(0, distanceA * distanceA - 2 * phi * distanceA * distanceB + distanceB * distanceB),
    );
  const rate = (f - g) / n;
  return {
    rate,
    low: Math.max(-1, rate - reach(rateA - first.low, second.high - rateB)),
    high: Math.min(1, rate + reach(first.high - rateA, rateB - second.low)),
  };
}

/** A percentage with one decimal, the way the report prints a rate. */
export function percent(rate: number | null): string {
  return rate === null ? '-' : `${(100 * rate).toFixed(1)}%`;
}
