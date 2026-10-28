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

/** A percentage with one decimal, the way the report prints a rate. */
export function percent(rate: number | null): string {
  return rate === null ? '-' : `${(100 * rate).toFixed(1)}%`;
}
