/**
 * Every figure on the results page, with the document it comes from. Nothing here is rounded or
 * worked out beyond what the documents say: counts are the reports' own, the intervals are the
 * reports' (Wilson for a pass rate, Newcombe for a paired difference), and a sentence says no more
 * than they do. Change a number here only from the reports.
 */

import { REPO } from './content';

/** The documents the figures come from, by the short name used under each block. */
export const SOURCES = {
  second: { name: 'returns-desk-2.md', path: 'docs/comparisons/returns-desk-2.md' },
  plan: { name: 'returns-desk-2-plan.md', path: 'docs/comparisons/returns-desk-2-plan.md' },
  first: { name: 'returns-desk-1.md', path: 'docs/comparisons/returns-desk-1.md' },
  readme: { name: 'README.md', path: 'README.md' },
  hackathon: { name: 'HACKATHON.md', path: 'docs/HACKATHON.md' },
} as const;

export type SourceKey = keyof typeof SOURCES;

/** Where a source is, on GitHub. */
export function sourceUrl(key: SourceKey): string {
  return `${REPO}/blob/main/${SOURCES[key].path}`;
}

/** The three kinds of request every returns desk is tested on, and how many of each. */
export const TYPES = ['Refunds', 'Order questions', 'Pickups'] as const;
export const PER_TYPE = 20;
/** The final test's size, and the number of passes the job's 95% target needs. */
export const TEST_SIZE = 60;
export const TARGET_PASSES = 57;

export type Tone = 'plain' | 'student' | 'mentor';

export interface Arm {
  name: string;
  /** Final-test passes out of 60 under seed 101. */
  passed: number;
  /** The reports' 95% Wilson interval for the pass rate, in percent. */
  low: number;
  high: number;
  /** Passes by kind of request, out of 20 each, in the order of TYPES. */
  byType: readonly [number, number, number];
  /** Median and 95th percentile answer time, in seconds. */
  p50: number;
  p95: number;
  /** What the arm cost, in dollars: Spark's share and the hosted Glimmer's. */
  spark: number;
  glimmer: number | null;
  tone: Tone;
}

export interface Pair {
  /** "A against B": the first arm less the second. */
  label: string;
  wins: number;
  losses: number;
  both: number;
  neither: number;
  /** The difference in pass rate in percentage points, with its 95% interval. */
  diff: number;
  low: number;
  high: number;
}

export interface Comparison {
  id: 'second' | 'first';
  title: string;
  /** The business, the rounds teaching was given, and the seed of the final test, in words. */
  setting: string;
  arms: readonly Arm[];
  pairs: readonly Pair[];
  source: SourceKey;
}

export const SECOND: Comparison = {
  id: 'second',
  title: 'A new returns desk, up to 8 rounds of teaching',
  setting: 'Final test of 60 requests, seed 101. Glimmer served online.',
  source: 'second',
  arms: [
    {
      name: 'Glimmer on its own',
      passed: 44,
      low: 61.0,
      high: 82.9,
      byType: [15, 12, 17],
      p50: 17.7,
      p95: 42.7,
      spark: 0,
      glimmer: 0.88,
      tone: 'plain',
    },
    {
      name: "Spark's one-shot setup",
      passed: 38,
      low: 50.7,
      high: 74.4,
      byType: [11, 10, 17],
      p50: 4.0,
      p95: 56.6,
      spark: 0.08,
      glimmer: 0.72,
      tone: 'plain',
    },
    {
      name: "Glimmer after Spark's teaching",
      passed: 58,
      low: 88.6,
      high: 99.1,
      byType: [19, 19, 20],
      p50: 3.5,
      p95: 4.8,
      spark: 0.34,
      glimmer: 1.66,
      tone: 'student',
    },
  ],
  pairs: [
    {
      label: 'Teaching against Glimmer on its own',
      wins: 15,
      losses: 1,
      both: 43,
      neither: 1,
      diff: 23.3,
      low: 10.9,
      high: 35.9,
    },
    {
      label: 'The one-shot setup against Glimmer on its own',
      wins: 8,
      losses: 14,
      both: 30,
      neither: 8,
      diff: -10.0,
      low: -24.8,
      high: 5.5,
    },
    {
      label: 'Teaching against the one-shot setup',
      wins: 20,
      losses: 0,
      both: 38,
      neither: 2,
      diff: 33.3,
      low: 20.7,
      high: 45.9,
    },
  ],
};

export const FIRST: Comparison = {
  id: 'first',
  title: 'The returns desk that ships, teaching held to 2 rounds',
  setting: 'Final test of 60 requests, seed 101. Glimmer served online.',
  source: 'first',
  arms: [
    {
      name: 'Glimmer on its own',
      passed: 43,
      low: 59.2,
      high: 81.5,
      byType: [15, 12, 16],
      p50: 17.7,
      p95: 70.5,
      spark: 0,
      glimmer: 0.85,
      tone: 'plain',
    },
    {
      name: "Spark's one-shot setup",
      passed: 47,
      low: 66.4,
      high: 86.9,
      byType: [16, 15, 16],
      p50: 8.1,
      p95: 54.8,
      spark: 0.12,
      glimmer: 0.82,
      tone: 'plain',
    },
    {
      name: "Glimmer after Spark's teaching",
      passed: 45,
      low: 62.8,
      high: 84.2,
      byType: [16, 14, 15],
      p50: 7.0,
      p95: 20.7,
      spark: 0.17,
      glimmer: 1.67,
      tone: 'student',
    },
    {
      name: 'Spark doing the job itself',
      passed: 60,
      low: 94.0,
      high: 100.0,
      byType: [20, 20, 20],
      p50: 13.8,
      p95: 29.5,
      spark: 2.3,
      glimmer: null,
      tone: 'mentor',
    },
  ],
  pairs: [
    {
      label: 'Teaching against Glimmer on its own',
      wins: 11,
      losses: 9,
      both: 34,
      neither: 6,
      diff: 3.3,
      low: -11.5,
      high: 18.0,
    },
    {
      label: 'The one-shot setup against Glimmer on its own',
      wins: 13,
      losses: 9,
      both: 34,
      neither: 4,
      diff: 6.7,
      low: -8.8,
      high: 21.8,
    },
    {
      label: 'Teaching against the one-shot setup',
      wins: 3,
      losses: 5,
      both: 42,
      neither: 10,
      diff: -3.3,
      low: -13.4,
      high: 6.6,
    },
    {
      label: 'Spark itself against Glimmer on its own',
      wins: 17,
      losses: 0,
      both: 43,
      neither: 0,
      diff: 28.3,
      low: 16.8,
      high: 40.8,
    },
  ],
};

/** One round of teaching: what Spark changed and how the check tasks scored it. */
export interface Round {
  n: number;
  change: string;
  /** Check tasks passed out of 45 before and after, in the first measurement. */
  before: number;
  after: number;
  /** The same change measured again on new seeds, over two runs (out of 90), where it was. */
  again?: readonly [number, number];
  kept: boolean;
  /** Why a change was not kept, in the report's words. */
  why?: string;
}

export const ROUNDS_SECOND: readonly Round[] = [
  {
    n: 1,
    change: 'Normalize dirty values in helpers',
    before: 31,
    after: 42,
    again: [62, 85],
    kept: true,
  },
  {
    n: 2,
    change: 'Strip currency symbols in money parsing helpers',
    before: 43,
    after: 44,
    kept: false,
    why: 'Short of the +2 margin',
  },
  {
    n: 3,
    change: 'Strip currency symbols in money parsing',
    before: 44,
    after: 44,
    kept: false,
    why: 'No change',
  },
  {
    n: 4,
    change: 'Parse dirty money with numeric extraction in helpers',
    before: 42,
    after: 44,
    again: [84, 88],
    kept: true,
  },
];

export const ROUNDS_FIRST: readonly Round[] = [
  {
    n: 1,
    change: 'Fix pickup_next to parse legacy pickup_from dates',
    before: 32,
    after: 35,
    again: [67, 68],
    kept: false,
    why: 'Short of the +4 margin',
  },
  {
    n: 2,
    change: 'Normalize legacy dates in pickup tool',
    before: 30,
    after: 39,
    again: [60, 73],
    kept: true,
  },
];

/** The repair shop's job, from one real run: a single run, not a planned comparison. */
export const REPAIR = {
  checkBefore: 22,
  checkAfter: 30,
  checkTotal: 30,
  finalPassed: 40,
  finalTotal: 40,
  cents: 11,
} as const;

/** What the whole run cost, from the second comparison's records. */
export const MONEY = {
  spark: 0.4205,
  glimmer: 3.3796,
} as const;
