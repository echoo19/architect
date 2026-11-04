import type {
  WspArm,
  WspCheck,
  WspComparison,
  WspExample,
  WspMeasurement,
  WspSplit,
} from '@architect/shared';
import { paired, pairedDifference } from '../comparisons/stats';

/*
 * How the runner scores an output: a deterministic check of its text, and a deterministic test
 * for repetition. No model judges another model's output here.
 */

/** One generated output, as the evaluator returns it. */
export interface WspOutput {
  text: string;
  tokens: number;
  cutOff: boolean;
}

const NUMBER = /-?\d+(?:,\d{3})*(?:\.\d+)?/g;

/** Whether an output passes its check. */
export function passes(check: WspCheck, text: string): boolean {
  const output = text.trim();
  switch (check.kind) {
    case 'exact':
      return output.toLowerCase() === check.value.trim().toLowerCase();
    case 'contains':
      return output.toLowerCase().includes(check.value.trim().toLowerCase());
    case 'regex':
      try {
        return new RegExp(check.value, 'i').test(output);
      } catch {
        return false;
      }
    case 'number': {
      const expected = Number(check.value.replace(/,/g, ''));
      const found = output.match(NUMBER);
      if (!Number.isFinite(expected) || found === null) return false;
      const last = Number(found[found.length - 1]!.replace(/,/g, ''));
      return Math.abs(last - expected) <= 1e-6 * Math.max(1, Math.abs(expected));
    }
  }
}

/** A check's pattern, refused before any run when it can't be compiled. */
export function checkProblem(check: WspCheck): string | null {
  if (check.kind === 'regex') {
    try {
      new RegExp(check.value, 'i');
    } catch (error) {
      return `The pattern "${check.value}" isn't a regular expression: ${(error as Error).message}`;
    }
  }
  if (check.kind === 'number' && !Number.isFinite(Number(check.value.replace(/,/g, '')))) {
    return `"${check.value}" isn't a number.`;
  }
  return null;
}

/**
 * Whether an output repeats itself: the same line three times running, or, over its last 60
 * words, fewer than half its word triples distinct.
 */
export function repeats(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let i = 2; i < lines.length; i += 1) {
    if (lines[i] === lines[i - 1] && lines[i] === lines[i - 2] && lines[i]!.length > 1) return true;
  }
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 24) return false;
  const tail = words.slice(-60);
  const triples = new Set<string>();
  for (let i = 0; i + 2 < tail.length; i += 1) triples.add(`${tail[i]} ${tail[i + 1]} ${tail[i + 2]}`);
  return triples.size / (tail.length - 2) < 0.5;
}

/** One arm's outputs on one split, scored. */
export function measure(
  arm: WspArm,
  split: WspSplit,
  examples: readonly WspExample[],
  outputs: readonly WspOutput[],
  seconds: number,
  candidateId?: string,
): WspMeasurement {
  if (outputs.length !== examples.length) {
    throw new Error(`The evaluator returned ${outputs.length} outputs for ${examples.length} prompts.`);
  }
  const outcomes = examples.map((example, index) => {
    const output = outputs[index]!;
    return {
      passed: example.check === undefined ? null : passes(example.check, output.text),
      looped: repeats(output.text),
    };
  });
  const checked = outcomes.filter((outcome) => outcome.passed !== null).length;
  const tokens = outputs.reduce((sum, output) => sum + output.tokens, 0);
  return {
    arm,
    split,
    ...(candidateId === undefined ? {} : { candidateId }),
    n: examples.length,
    passed: checked === 0 ? null : outcomes.filter((outcome) => outcome.passed === true).length,
    checked,
    looped: outcomes.filter((outcome) => outcome.looped).length,
    cutOff: outputs.filter((output) => output.cutOff).length,
    meanTokens: examples.length === 0 ? 0 : tokens / examples.length,
    seconds,
    outcomes,
  };
}

/** A measurement's pass rate or loop rate in points, or null when it has none. */
export function points(item: WspMeasurement, metric: 'pass_rate' | 'loop_rate'): number | null {
  if (metric === 'loop_rate') return item.n === 0 ? null : (100 * item.looped) / item.n;
  return item.passed === null || item.checked === 0 ? null : (100 * item.passed) / item.checked;
}

/**
 * The candidate less another arm on the same examples, in points, with Newcombe's 95% interval
 * for paired proportions. Null when they share no scored example.
 */
export function compare(
  candidate: WspMeasurement,
  other: WspMeasurement,
  metric: 'pass_rate' | 'loop_rate',
): WspComparison | null {
  const pick = (item: WspMeasurement) =>
    new Map(
      item.outcomes.flatMap((outcome, index) => {
        const value = metric === 'loop_rate' ? outcome.looped : outcome.passed;
        return value === null ? [] : [[String(index), value] as const];
      }),
    );
  const counts = paired(pick(candidate), pick(other));
  const difference = pairedDifference(counts);
  if (difference === null) return null;
  return {
    against: other.arm,
    metric,
    split: candidate.split,
    points: 100 * difference.rate,
    low: 100 * difference.low,
    high: 100 * difference.high,
    n: counts.scenarios,
  };
}

/** Whether a change on the target metric is a gain: more passes, or fewer loops. */
export function gain(metric: 'pass_rate' | 'loop_rate', change: number): number {
  return metric === 'loop_rate' ? -change : change;
}
