/**
 * Every figure on the results page, with the document it comes from. Nothing here is rounded or
 * worked out beyond what the documents say: counts are the reports' own, the intervals are the
 * reports' (Wilson for a pass rate, Newcombe for a paired difference), and a sentence says no more
 * than they do. Change a number here only from the reports.
 */

import { REPO } from './content';

/** The documents the figures come from, by the short name used under each block. */
export const SOURCES = {
  academyDesk: { name: 'academy-desk-1.md', path: 'docs/comparisons/academy-desk-1.md' },
  local: { name: 'academy-desk-1-local.md', path: 'docs/comparisons/academy-desk-1-local.md' },
  scale: { name: 'SCALE.md', path: 'docs/SCALE.md' },
  second: { name: 'returns-desk-2.md', path: 'docs/comparisons/returns-desk-2.md' },
  plan: { name: 'returns-desk-2-plan.md', path: 'docs/comparisons/returns-desk-2-plan.md' },
  first: { name: 'returns-desk-1.md', path: 'docs/comparisons/returns-desk-1.md' },
  certify: { name: 'CERTIFY.md', path: 'docs/CERTIFY.md' },
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
  /** Check tasks in one run, and in the two runs of a measurement made again. Default 45 and 90. */
  total?: number;
  againTotal?: number;
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

/**
 * The field run: Academy desk, an operations agent for test-prep academies. Final-test tasks are counted per group of
 * organizations, under seed 101, from `academy-desk-1.md`. Intervals are the report's own: Wilson for a
 * pass rate, Newcombe for a paired difference.
 */
export const GROUPS = [
  { name: 'Taught academies', short: 'taught', n: 48 },
  { name: 'Harborview Prep', short: 'harborview', n: 48 },
  { name: 'Real academy', short: 'real', n: 24 },
] as const;

export type GroupKey = (typeof GROUPS)[number]['short'];

export interface FieldArm {
  name: string;
  /** Passes in each group, in the order of GROUPS, with the Wilson interval in percent. */
  groups: readonly { passed: number; low: number; high: number }[];
  /** Passes out of all 120, with its interval. */
  all: { passed: number; low: number; high: number };
  tone: Tone;
}

export const FIELD_TEST_SIZE = 120;

export const FIELD_ARMS: readonly FieldArm[] = [
  {
    name: 'Glimmer on a blank setup',
    groups: [
      { passed: 21, low: 30.7, high: 57.7 },
      { passed: 24, low: 36.4, high: 63.6 },
      { passed: 9, low: 21.2, high: 57.3 },
    ],
    all: { passed: 54, low: 36.4, high: 53.9 },
    tone: 'plain',
  },
  {
    name: "Spark's one-shot setup",
    groups: [
      { passed: 22, low: 32.6, high: 59.7 },
      { passed: 22, low: 32.6, high: 59.7 },
      { passed: 11, low: 27.9, high: 64.9 },
    ],
    all: { passed: 55, low: 37.2, high: 54.7 },
    tone: 'plain',
  },
  {
    name: 'Academy desk',
    groups: [
      { passed: 44, low: 80.4, high: 96.7 },
      { passed: 43, low: 77.8, high: 95.5 },
      { passed: 12, low: 31.4, high: 68.6 },
    ],
    all: { passed: 99, low: 74.7, high: 88.3 },
    tone: 'student',
  },
];

export const SKILLS = ['Diagnose', 'Solve', 'Hint', 'History', 'Assign', 'Tutoring turn'] as const;

export interface SkillRow {
  skill: (typeof SKILLS)[number];
  group: GroupKey;
  /** Tasks in the cell; passes for the blank setup, the one-shot setup and Academy desk. */
  of: number;
  bare: number;
  draft: number;
  academyDesk: number;
}

/** Skill by organization. The Real academy had tasks for three skills only. */
export const SKILL_ROWS: readonly SkillRow[] = [
  { skill: 'Diagnose', group: 'taught', of: 9, bare: 6, draft: 6, academyDesk: 8 },
  { skill: 'Diagnose', group: 'harborview', of: 8, bare: 6, draft: 8, academyDesk: 6 },
  { skill: 'Diagnose', group: 'real', of: 8, bare: 4, draft: 4, academyDesk: 2 },
  { skill: 'Solve', group: 'taught', of: 6, bare: 6, draft: 6, academyDesk: 6 },
  { skill: 'Solve', group: 'harborview', of: 8, bare: 8, draft: 8, academyDesk: 8 },
  { skill: 'Hint', group: 'taught', of: 9, bare: 2, draft: 3, academyDesk: 9 },
  { skill: 'Hint', group: 'harborview', of: 8, bare: 4, draft: 1, academyDesk: 7 },
  { skill: 'History', group: 'taught', of: 6, bare: 5, draft: 4, academyDesk: 6 },
  { skill: 'History', group: 'harborview', of: 8, bare: 5, draft: 2, academyDesk: 8 },
  { skill: 'History', group: 'real', of: 8, bare: 5, draft: 6, academyDesk: 3 },
  { skill: 'Assign', group: 'taught', of: 9, bare: 2, draft: 3, academyDesk: 8 },
  { skill: 'Assign', group: 'harborview', of: 8, bare: 1, draft: 3, academyDesk: 8 },
  { skill: 'Assign', group: 'real', of: 8, bare: 0, draft: 1, academyDesk: 7 },
  { skill: 'Tutoring turn', group: 'taught', of: 9, bare: 0, draft: 0, academyDesk: 7 },
  { skill: 'Tutoring turn', group: 'harborview', of: 8, bare: 0, draft: 0, academyDesk: 6 },
];

export interface FieldPair {
  /** "A against B": the first arm less the second. */
  label: string;
  group: GroupKey | 'all';
  n: number;
  wins: number;
  losses: number;
  both: number;
  neither: number;
  /** The difference in pass rate in percentage points, with its 95% interval. */
  diff: number;
  low: number;
  high: number;
}

export const FIELD_PAIRS: readonly FieldPair[] = [
  {
    label: 'Academy desk against a blank setup',
    group: 'harborview',
    n: 48,
    wins: 20,
    losses: 1,
    both: 23,
    neither: 4,
    diff: 39.6,
    low: 22.9,
    high: 53.7,
  },
  {
    label: 'Academy desk against a blank setup',
    group: 'real',
    n: 24,
    wins: 9,
    losses: 6,
    both: 3,
    neither: 6,
    diff: 12.5,
    low: -17.9,
    high: 40.2,
  },
  {
    label: 'Academy desk against a blank setup',
    group: 'taught',
    n: 48,
    wins: 24,
    losses: 1,
    both: 20,
    neither: 3,
    diff: 47.9,
    low: 30.3,
    high: 61.7,
  },
  {
    label: 'Academy desk against a blank setup',
    group: 'all',
    n: 120,
    wins: 53,
    losses: 8,
    both: 46,
    neither: 13,
    diff: 37.5,
    low: 25.9,
    high: 47.7,
  },
  {
    label: 'Academy desk against the one-shot setup',
    group: 'harborview',
    n: 48,
    wins: 23,
    losses: 2,
    both: 20,
    neither: 3,
    diff: 43.8,
    low: 25.6,
    high: 58.3,
  },
  {
    label: 'Academy desk against the one-shot setup',
    group: 'real',
    n: 24,
    wins: 7,
    losses: 6,
    both: 5,
    neither: 6,
    diff: 4.2,
    low: -23.6,
    high: 31.0,
  },
  {
    label: 'Academy desk against the one-shot setup',
    group: 'taught',
    n: 48,
    wins: 23,
    losses: 1,
    both: 21,
    neither: 3,
    diff: 45.8,
    low: 28.4,
    high: 59.8,
  },
  {
    label: 'The one-shot setup against a blank setup',
    group: 'harborview',
    n: 48,
    wins: 6,
    losses: 8,
    both: 16,
    neither: 18,
    diff: -4.2,
    low: -19.2,
    high: 11.2,
  },
  {
    label: 'The one-shot setup against a blank setup',
    group: 'real',
    n: 24,
    wins: 6,
    losses: 4,
    both: 5,
    neither: 9,
    diff: 8.3,
    low: -17.5,
    high: 32.6,
  },
  {
    label: 'The one-shot setup against a blank setup',
    group: 'taught',
    n: 48,
    wins: 8,
    losses: 7,
    both: 14,
    neither: 19,
    diff: 2.1,
    low: -13.7,
    high: 17.7,
  },
  {
    label: 'The one-shot setup against a blank setup',
    group: 'all',
    n: 120,
    wins: 20,
    losses: 19,
    both: 35,
    neither: 46,
    diff: 0.8,
    low: -9.4,
    high: 11.0,
  },
];

/** Academy desk's three rounds of teaching, on the 36 check tasks of the taught academies. */
export const ROUNDS_FIELD: readonly Round[] = [
  {
    n: 1,
    change: 'A question lookup tool, and a rule against reading the whole question files',
    before: 17,
    after: 25,
    again: [36, 51],
    kept: true,
    total: 36,
    againTotal: 72,
  },
  {
    n: 2,
    change: 'A practice pick that reads the count and difficulty from the academy policy',
    before: 24,
    after: 23,
    kept: false,
    why: 'Short of the +2 margin',
    total: 36,
  },
  {
    n: 3,
    change: 'A policy lookup tool that returns the numbers every skill needs',
    before: 24,
    after: 35,
    again: [46, 71],
    kept: true,
    total: 36,
    againTotal: 72,
  },
];

/** What the field run cost, from its report. Spark's share includes about $0.08 of estimates. */
export const FIELD_MONEY = {
  spark: 0.58,
  glimmer: 4.26,
} as const;

/**
 * Academy desk, frozen, on the same 120 final-test tasks again on the 2-bit Glimmer that runs on one
 * 12 GB graphics card, from `academy-desk-1-local.md`. Hosted passes are Academy desk's in `FIELD_ARMS`. Wins and
 * losses are local against hosted, task by task; intervals are the report's Newcombe intervals.
 */
export interface LocalRow {
  group: GroupKey | 'all';
  n: number;
  local: number;
  hosted: number;
  wins: number;
  losses: number;
  diff: number;
  low: number;
  high: number;
}

export const LOCAL_ROWS: readonly LocalRow[] = [
  {
    group: 'taught',
    n: 48,
    local: 45,
    hosted: 44,
    wins: 3,
    losses: 2,
    diff: 2.1,
    low: -9.3,
    high: 13.7,
  },
  {
    group: 'harborview',
    n: 48,
    local: 41,
    hosted: 43,
    wins: 3,
    losses: 5,
    diff: -4.2,
    low: -17.2,
    high: 8.7,
  },
  {
    group: 'real',
    n: 24,
    local: 17,
    hosted: 12,
    wins: 6,
    losses: 1,
    diff: 20.8,
    low: -0.9,
    high: 39.6,
  },
  {
    group: 'all',
    n: 120,
    local: 103,
    hosted: 99,
    wins: 12,
    losses: 8,
    diff: 3.3,
    low: -4.3,
    high: 11.0,
  },
];

/** Time per task and tasks stopped at the step limit, local against hosted. */
export const LOCAL_SPEED = {
  medianLocal: 38,
  medianHosted: 9,
  slowestLocal: 174,
  slowestHosted: 59,
  stepLimitLocal: 11,
  stepLimitHosted: 7,
} as const;
