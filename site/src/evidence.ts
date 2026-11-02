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
  third: { name: 'academy-desk-3.md', path: 'docs/comparisons/academy-desk-3.md' },
  thirdMisses: {
    name: 'academy-desk-3-misses.md',
    path: 'docs/comparisons/academy-desk-3-misses.md',
  },
  cert: { name: 'academy-desk-cert-1.md', path: 'docs/comparisons/academy-desk-cert-1.md' },
  cert2: { name: 'academy-desk-cert-2.md', path: 'docs/comparisons/academy-desk-cert-2.md' },
  inventory: { name: 'inventory-desk-1.md', path: 'docs/comparisons/inventory-desk-1.md' },
  open: { name: 'returns-desk-open-1.md', path: 'docs/comparisons/returns-desk-open-1.md' },
  assay: { name: 'assay-desk-1.md', path: 'docs/comparisons/assay-desk-1.md' },
  assay2: { name: 'assay-desk-2.md', path: 'docs/comparisons/assay-desk-2.md' },
  team2: { name: 'team-2.md', path: 'docs/comparisons/team-2.md' },
  qlora1: { name: 'qlora-1.md', path: 'docs/comparisons/qlora-1.md' },
  qlora2: { name: 'qlora-2.md', path: 'docs/comparisons/qlora-2.md' },
  adapterEval: { name: 'adapter-eval-1.md', path: 'docs/comparisons/adapter-eval-1.md' },
  sweep2: { name: 'sweep-desk-2.md', path: 'docs/comparisons/sweep-desk-2.md' },
  scale: { name: 'SCALE.md', path: 'docs/SCALE.md' },
  second: { name: 'returns-desk-2.md', path: 'docs/comparisons/returns-desk-2.md' },
  plan: { name: 'returns-desk-2-plan.md', path: 'docs/comparisons/returns-desk-2-plan.md' },
  first: { name: 'returns-desk-1.md', path: 'docs/comparisons/returns-desk-1.md' },
  certify: { name: 'CERTIFY.md', path: 'docs/CERTIFY.md' },
  hackathon: { name: 'HACKATHON.md', path: 'docs/HACKATHON.md' },
  decisions: { name: 'DECISIONS.md', path: 'docs/DECISIONS.md' },
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
  id: 'second' | 'first' | 'open';
  title: string;
  /** The business, the rounds teaching was given, and the seed of the final test, in words. */
  setting: string;
  arms: readonly Arm[];
  pairs: readonly Pair[];
  source: SourceKey;
}

export const SECOND: Comparison = {
  id: 'second',
  title: 'The returns desk that ships, up to 8 rounds of teaching',
  setting: 'Final test of 60 requests, seed 101. Glimmer served online.',
  source: 'second',
  arms: [
    {
      name: 'Glimmer on the base harness',
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
      name: "Spark's one-shot harness",
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
      name: 'Glimmer on the Spark-engineered harness',
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
      label: 'Spark-engineered against the base harness',
      wins: 15,
      losses: 1,
      both: 43,
      neither: 1,
      diff: 23.3,
      low: 10.9,
      high: 35.9,
    },
    {
      label: 'The one-shot harness against the base harness',
      wins: 8,
      losses: 14,
      both: 30,
      neither: 8,
      diff: -10.0,
      low: -24.8,
      high: 5.5,
    },
    {
      label: 'Spark-engineered against the one-shot harness',
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
  title: 'The first returns desk, teaching held to 2 rounds',
  setting: 'Final test of 60 requests, seed 101. Glimmer served online.',
  source: 'first',
  arms: [
    {
      name: 'Glimmer on the base harness',
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
      name: "Spark's one-shot harness",
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
      name: 'Glimmer on the Spark-engineered harness',
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
      label: 'Spark-engineered against the base harness',
      wins: 11,
      losses: 9,
      both: 34,
      neither: 6,
      diff: 3.3,
      low: -11.5,
      high: 18.0,
    },
    {
      label: 'The one-shot harness against the base harness',
      wins: 13,
      losses: 9,
      both: 34,
      neither: 4,
      diff: 6.7,
      low: -8.8,
      high: 21.8,
    },
    {
      label: 'Spark-engineered against the one-shot harness',
      wins: 3,
      losses: 5,
      both: 42,
      neither: 10,
      diff: -3.3,
      low: -13.4,
      high: 6.6,
    },
    {
      label: 'Spark itself against the base harness',
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

/**
 * The returns desk taught by Muse Spark Open, Meta's open-weight teacher, served by BaseTen, from
 * `returns-desk-open-1.md`. Every arm ran under Glimmer's on-device context of 16,384 tokens, so it
 * is not set against the earlier returns desk runs. Costs are each arm's own, from the runner's table.
 */
export const OPEN: Comparison = {
  id: 'open',
  title: 'The returns desk, taught by Muse Spark Open',
  setting:
    'Final test of 60 requests, seed 101. Glimmer served online, under a 16,384-token context.',
  source: 'open',
  arms: [
    {
      name: 'Glimmer on the base harness',
      passed: 18,
      low: 19.9,
      high: 42.5,
      byType: [7, 6, 5],
      p50: 8.8,
      p95: 67.7,
      spark: 0,
      glimmer: 0.65,
      tone: 'plain',
    },
    {
      name: "Spark Open's one-shot harness",
      passed: 31,
      low: 39.3,
      high: 63.8,
      byType: [13, 7, 11],
      p50: 8.4,
      p95: 99.1,
      spark: 0.11,
      glimmer: 0.93,
      tone: 'plain',
    },
    {
      name: 'Glimmer on the Spark Open-engineered harness',
      passed: 39,
      low: 52.4,
      high: 75.8,
      byType: [14, 10, 15],
      p50: 6.0,
      p95: 38.4,
      spark: 0.08,
      glimmer: 1.49,
      tone: 'student',
    },
  ],
  pairs: [
    {
      label: 'Spark Open-engineered against the base harness',
      wins: 28,
      losses: 7,
      both: 11,
      neither: 14,
      diff: 35.0,
      low: 16.8,
      high: 50.2,
    },
    {
      label: 'The one-shot harness against the base harness',
      wins: 21,
      losses: 8,
      both: 10,
      neither: 21,
      diff: 21.7,
      low: 4.2,
      high: 37.4,
    },
    {
      label: 'Spark Open-engineered against the one-shot harness',
      wins: 8,
      losses: 0,
      both: 31,
      neither: 21,
      diff: 13.3,
      low: 4.1,
      high: 22.1,
    },
  ],
};

/** What the Spark Open run cost in all, from its report. */
export const OPEN_MONEY = {
  sparkOpen: 0.19,
  glimmer: 3.13,
} as const;

/** One round of teaching: what Spark changed and how the held-out checks scored it. */
export interface Round {
  n: number;
  change: string;
  /** Held-out checks passed out of 45 before and after, in the first measurement. */
  before: number;
  after: number;
  /** The same change measured again on new seeds, over two runs (out of 90), where it was. */
  again?: readonly [number, number];
  kept: boolean;
  /** Why a change was not kept, in the report's words. */
  why?: string;
  /** Held-out checks in one run, and in the two runs of a measurement made again. Default 45 and 90. */
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

/** The repair shop's job, from the film's demo run: a single run, not a planned comparison. */
export const REPAIR = {
  checkBefore: 22,
  checkAfter: 30,
  checkTotal: 30,
  finalPassed: 40,
  finalTotal: 40,
  cents: 11,
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
  /** Passes in each group, in the order of its run's groups, with the Wilson interval in percent. */
  groups: readonly { passed: number; low: number; high: number }[];
  /** Passes in all groups together, with its interval. */
  all: { passed: number; low: number; high: number };
  tone: Tone;
}

export const FIELD_TEST_SIZE = 120;

export const FIELD_ARMS: readonly FieldArm[] = [
  {
    name: 'Glimmer on the base harness',
    groups: [
      { passed: 21, low: 30.7, high: 57.7 },
      { passed: 24, low: 36.4, high: 63.6 },
      { passed: 9, low: 21.2, high: 57.3 },
    ],
    all: { passed: 54, low: 36.4, high: 53.9 },
    tone: 'plain',
  },
  {
    name: "Spark's one-shot harness",
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
  /** Tasks in the cell; passes for the base harness, the one-shot harness and Academy desk. */
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

/** A pairing of two arms in one group of a field run, or in all of them. */
export interface FieldPair<G extends string = GroupKey> {
  /** "A against B": the first arm less the second. */
  label: string;
  group: G | 'all';
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
    label: 'Academy desk against the base harness',
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
    label: 'Academy desk against the base harness',
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
    label: 'Academy desk against the base harness',
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
    label: 'Academy desk against the base harness',
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
    label: 'Academy desk against the one-shot harness',
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
    label: 'Academy desk against the one-shot harness',
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
    label: 'Academy desk against the one-shot harness',
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
    label: 'The one-shot harness against the base harness',
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
    label: 'The one-shot harness against the base harness',
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
    label: 'The one-shot harness against the base harness',
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
    label: 'The one-shot harness against the base harness',
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

/** Academy desk's three rounds of teaching, on the 36 held-out checks of the taught academies. */
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

/**
 * The third field run, from `academy-desk-3.md`: the base harness and Academy desk on a sealed test of
 * 126 tasks, by group. Passes carry the report's Wilson intervals; wins and losses are Academy desk
 * against the base harness, task by task, with the report's Newcombe interval.
 */
export interface ThirdRow {
  group: 'taught' | 'juniper' | 'real' | 'all';
  name: string;
  n: number;
  bare: { passed: number; low: number; high: number };
  academyDesk: { passed: number; low: number; high: number };
  wins: number;
  losses: number;
  both: number;
  neither: number;
  diff: number;
  low: number;
  high: number;
}

export const THIRD_TEST_SIZE = 126;

export const THIRD_ROWS: readonly ThirdRow[] = [
  {
    group: 'taught',
    name: 'Taught academies',
    n: 48,
    bare: { passed: 15, low: 19.9, high: 45.3 },
    academyDesk: { passed: 24, low: 36.4, high: 63.6 },
    wins: 13,
    losses: 4,
    both: 11,
    neither: 20,
    diff: 18.8,
    low: 2.0,
    high: 33.9,
  },
  {
    group: 'juniper',
    name: 'Juniper Study House',
    n: 48,
    bare: { passed: 15, low: 19.9, high: 45.3 },
    academyDesk: { passed: 31, low: 50.4, high: 76.6 },
    wins: 18,
    losses: 2,
    both: 13,
    neither: 15,
    diff: 33.3,
    low: 16.2,
    high: 47.5,
  },
  {
    group: 'real',
    name: 'Real academy',
    n: 30,
    bare: { passed: 13, low: 27.4, high: 60.8 },
    academyDesk: { passed: 3, low: 3.5, high: 25.6 },
    wins: 0,
    losses: 10,
    both: 3,
    neither: 17,
    diff: -33.3,
    low: -50.3,
    high: -14.2,
  },
  {
    group: 'all',
    name: 'All groups',
    n: 126,
    bare: { passed: 43, low: 26.4, high: 42.8 },
    academyDesk: { passed: 58, low: 37.6, high: 54.7 },
    wins: 31,
    losses: 16,
    both: 27,
    neither: 52,
    diff: 11.9,
    low: 1.3,
    high: 22.1,
  },
];

/** What the third run cost, from its report. */
export const THIRD_MONEY = {
  spark: 0.44,
  glimmer: 7.35,
} as const;

/**
 * The first live certificate run, from `academy-desk-cert-1.md`: the third run's Academy desk, frozen,
 * on 60 calibration tasks and the Real academy's 10 check tasks, five attempts each. No certificate
 * was issued. Bounds are the report's one-sided 95% Clopper-Pearson upper bounds, in percent.
 */
export const CERT = {
  calibration: 60,
  attempts: 5,
  target: 10,
  confidence: 95,
  checkTasks: 10,
  usd: 4.42,
  runs: 350,
} as const;

export interface CertRow {
  /** How many of the five attempts must agree for Academy desk to answer. */
  when: string;
  /** Calibration tasks answered and wrong, of 60, with the share handed off in percent. */
  answered: number;
  wrong: number;
  handedOff: number;
  bound: number;
  /** The Real academy's check tasks answered and wrong, of 10. */
  realAnswered: number;
  realWrong: number;
}

export const CERT_ROWS: readonly CertRow[] = [
  {
    when: '5 of 5 agree',
    answered: 46,
    wrong: 14,
    handedOff: 23,
    bound: 43.5,
    realAnswered: 8,
    realWrong: 8,
  },
  {
    when: '4 or more of 5',
    answered: 52,
    wrong: 16,
    handedOff: 13,
    bound: 43.0,
    realAnswered: 9,
    realWrong: 9,
  },
  {
    when: '3 or more of 5',
    answered: 60,
    wrong: 21,
    handedOff: 0,
    bound: 46.4,
    realAnswered: 10,
    realWrong: 10,
  },
];

/**
 * The second live certificate run, from `academy-desk-cert-2.md`: the first field run's Academy
 * desk, frozen, on 60 calibration tasks from the taught academies, five attempts each, checked on
 * 54 sealed Harborview Prep tasks. Bounds are the report's one-sided 95% Clopper-Pearson upper
 * bounds, in percent.
 */
export const CERT2 = {
  calibration: 60,
  attempts: 5,
  target: 10,
  confidence: 95,
  /** The certificate's bound, and the whole percent the app states it as. */
  bound: 4.87,
  stated: 5,
  /** The share of calibration tasks answered at the certified threshold, in percent. */
  coverage: 100,
  checkTasks: 54,
  checkAnswered: 53,
  checkWrong: 0,
  /** The upper bound on 0 wrong of 53 on its own, in percent. */
  checkBound: 5.5,
  runs: 570,
  usd: 1.28,
} as const;

export interface CertCalibrationRow {
  /** How many of the five attempts must agree for Academy desk to answer. */
  when: string;
  /** Calibration tasks answered and wrong, of 60, the share handed off and the bound, in percent. */
  answered: number;
  wrong: number;
  handedOff: number;
  bound: number;
}

export const CERT2_ROWS: readonly CertCalibrationRow[] = [
  { when: '5 of 5 agree', answered: 59, wrong: 0, handedOff: 2, bound: 4.95 },
  { when: '4 or more of 5', answered: 59, wrong: 0, handedOff: 2, bound: 4.95 },
  { when: '3, 2 or 1 or more of 5', answered: 60, wrong: 0, handedOff: 0, bound: 4.87 },
];

/** The check at Harborview Prep, by threshold: tasks answered, wrong and handed off, of 54. */
export interface CertCheckRow {
  when: string;
  answered: number;
  wrong: number;
  handedOff: number;
}

export const CERT2_CHECK: readonly CertCheckRow[] = [
  { when: '5 of 5 agree', answered: 48, wrong: 0, handedOff: 6 },
  { when: '4 or more of 5', answered: 50, wrong: 0, handedOff: 4 },
  { when: '3 or more of 5', answered: 51, wrong: 0, handedOff: 3 },
  { when: '2 or more of 5', answered: 52, wrong: 0, handedOff: 2 },
  { when: '1 or more of 5', answered: 53, wrong: 0, handedOff: 1 },
];

/**
 * Inventory desk, a screening lab's compound store, from `inventory-desk-1.md`: the base harness,
 * Spark's one-shot harness and the Spark-engineered harness on a sealed final test of 56 tasks, by
 * group, under seed 101. Corvid Hill Discovery was sealed from both models. Intervals are the
 * report's own: Wilson for a pass rate, Newcombe for a paired difference.
 */
export const LAB_GROUPS = [
  { name: 'Taught labs', short: 'seen', n: 24 },
  { name: 'Corvid Hill Discovery', short: 'corvid', n: 32 },
] as const;

export type LabGroupKey = (typeof LAB_GROUPS)[number]['short'];

export const LAB_TEST_SIZE = 56;

export const LAB_ARMS: readonly FieldArm[] = [
  {
    name: 'Glimmer on the base harness',
    groups: [
      { passed: 3, low: 4.3, high: 31.0 },
      { passed: 4, low: 5.0, high: 28.1 },
    ],
    all: { passed: 7, low: 6.2, high: 23.6 },
    tone: 'plain',
  },
  {
    name: "Spark's one-shot harness",
    groups: [
      { passed: 14, low: 38.8, high: 75.5 },
      { passed: 28, low: 71.9, high: 95.0 },
    ],
    all: { passed: 42, low: 62.3, high: 84.5 },
    tone: 'plain',
  },
  {
    name: 'Inventory desk',
    groups: [
      { passed: 21, low: 69.0, high: 95.7 },
      { passed: 27, low: 68.2, high: 93.1 },
    ],
    all: { passed: 48, low: 74.3, high: 92.6 },
    tone: 'student',
  },
];

export const LAB_SKILLS = ['Usable', 'Pick a lot', 'Allocate', 'Reserve'] as const;

export interface LabSkillRow {
  skill: (typeof LAB_SKILLS)[number];
  group: LabGroupKey;
  /** Tasks in the cell; passes for the base harness, the one-shot harness and Inventory desk. */
  of: number;
  bare: number;
  draft: number;
  inventoryDesk: number;
}

export const LAB_SKILL_ROWS: readonly LabSkillRow[] = [
  { skill: 'Usable', group: 'seen', of: 6, bare: 1, draft: 5, inventoryDesk: 5 },
  { skill: 'Usable', group: 'corvid', of: 8, bare: 3, draft: 8, inventoryDesk: 5 },
  { skill: 'Pick a lot', group: 'seen', of: 6, bare: 2, draft: 3, inventoryDesk: 5 },
  { skill: 'Pick a lot', group: 'corvid', of: 8, bare: 0, draft: 8, inventoryDesk: 8 },
  { skill: 'Allocate', group: 'seen', of: 6, bare: 0, draft: 5, inventoryDesk: 6 },
  { skill: 'Allocate', group: 'corvid', of: 8, bare: 0, draft: 6, inventoryDesk: 7 },
  { skill: 'Reserve', group: 'seen', of: 6, bare: 0, draft: 1, inventoryDesk: 5 },
  { skill: 'Reserve', group: 'corvid', of: 8, bare: 1, draft: 6, inventoryDesk: 7 },
];

/** Every pairing the report gives, task by task. */
export const LAB_PAIRS: readonly FieldPair<LabGroupKey>[] = [
  {
    label: 'Inventory desk against the base harness',
    group: 'corvid',
    n: 32,
    wins: 24,
    losses: 1,
    both: 3,
    neither: 4,
    diff: 71.9,
    low: 48.4,
    high: 84.0,
  },
  {
    label: 'Inventory desk against the base harness',
    group: 'seen',
    n: 24,
    wins: 19,
    losses: 1,
    both: 2,
    neither: 2,
    diff: 75.0,
    low: 45.9,
    high: 87.8,
  },
  {
    label: 'Inventory desk against the base harness',
    group: 'all',
    n: 56,
    wins: 43,
    losses: 2,
    both: 5,
    neither: 6,
    diff: 73.2,
    low: 56.1,
    high: 83.2,
  },
  {
    label: 'The one-shot harness against the base harness',
    group: 'corvid',
    n: 32,
    wins: 24,
    losses: 0,
    both: 4,
    neither: 4,
    diff: 75.0,
    low: 53.0,
    high: 85.6,
  },
  {
    label: 'The one-shot harness against the base harness',
    group: 'seen',
    n: 24,
    wins: 12,
    losses: 1,
    both: 2,
    neither: 9,
    diff: 45.8,
    low: 19.0,
    high: 64.9,
  },
  {
    label: 'Inventory desk against the one-shot harness',
    group: 'corvid',
    n: 32,
    wins: 3,
    losses: 4,
    both: 24,
    neither: 1,
    diff: -3.1,
    low: -20.9,
    high: 14.7,
  },
  {
    label: 'Inventory desk against the one-shot harness',
    group: 'seen',
    n: 24,
    wins: 10,
    losses: 3,
    both: 11,
    neither: 0,
    diff: 29.2,
    low: 0.2,
    high: 52.6,
  },
  {
    label: 'Inventory desk against the one-shot harness',
    group: 'all',
    n: 56,
    wins: 13,
    losses: 7,
    both: 35,
    neither: 1,
    diff: 10.7,
    low: -5.0,
    high: 25.8,
  },
];

/**
 * What Inventory desk's run cost and what its draft and kept round did on the held-out checks,
 * from its report. Spark's recorded spend leaves out a study call that was cut off, at most about
 * $0.18. The held-out checks are the taught labs' 24; the kept round is confirmed over two runs, of 48.
 */
export const LAB_RUN = {
  spark: 0.34,
  sparkUnrecorded: 0.18,
  glimmer: 1.38,
  checks: 24,
  draftBefore: 8,
  draftAfter: 22,
  keptBefore: 34,
  keptAfter: 40,
  keptTotal: 48,
} as const;

/** The training loss at each optimizer step of Inventory desk's QLoRA run, from its report. */
export const FINETUNE_LOSS: readonly { step: number; loss: number }[] = [
  { step: 1, loss: 0.106 },
  { step: 2, loss: 0.0879 },
  { step: 3, loss: 0.0693 },
  { step: 4, loss: 0.0328 },
  { step: 5, loss: 0.0255 },
  { step: 6, loss: 0.0078 },
];

/**
 * The two QLoRA adapters of Glimmer, each trained on one A100 on Hugging Face Jobs, with the
 * checks the product ran on each at the file level, from their reports. Inventory desk's is
 * measured on its sealed final test below; Sweep desk's has not been.
 */
export interface Adapter {
  desk: string;
  source: 'qlora1' | 'qlora2';
  examples: number;
  steps: number;
  gpuMinutes: number;
  trainingMinutes: number;
  usd: number;
  pairs: number;
  rank: number;
  alpha: number;
  sha256: string;
}

export const ADAPTERS: readonly Adapter[] = [
  {
    desk: 'Inventory desk',
    source: 'qlora1',
    examples: 22,
    steps: 6,
    gpuMinutes: 8.2,
    trainingMinutes: 4.8,
    usd: 0.34,
    pairs: 312,
    rank: 16,
    alpha: 32,
    sha256: '1ff8de7b',
  },
  {
    desk: 'Sweep desk',
    source: 'qlora2',
    examples: 6,
    steps: 2,
    gpuMinutes: 5.1,
    trainingMinutes: 1.8,
    usd: 0.21,
    pairs: 312,
    rank: 16,
    alpha: 32,
    sha256: 'b1564f43',
  },
];

/**
 * Sweep desk's second run on all 84 final-test tasks, a secondary outcome: the draft-based taught
 * arm against bare.
 */
export const SWEEP_RUN = { tasks: 84, taught: 37, bare: 26 } as const;

/**
 * Inventory desk's adapter on Inventory desk's sealed final test, from `adapter-eval-1.md`: the
 * taught harness and the base harness, each with the adapter and without it, on one deployment of
 * Glimmer under seed 101. Each count is out of the tasks that arm took, since two base-arm tasks
 * never ran. Intervals are the report's own: Wilson for a pass rate, Newcombe for a paired
 * difference.
 */
export interface AdapterArm {
  name: string;
  /** Passes at the taught labs and at Corvid Hill Discovery, out of the tasks taken. */
  groups: readonly { passed: number; of: number; low: number; high: number }[];
  all: { passed: number; of: number; low: number; high: number };
  /** Output tokens a call, and the median and 95th-percentile seconds an attempt. */
  tokens: number;
  p50: number;
  p95: number;
  tone: Tone;
}

export const ADAPTER_ARMS: readonly AdapterArm[] = [
  {
    name: 'Glimmer on the base harness',
    groups: [
      { passed: 5, of: 24, low: 9.2, high: 40.5 },
      { passed: 3, of: 32, low: 3.2, high: 24.2 },
    ],
    all: { passed: 8, of: 56, low: 7.4, high: 25.7 },
    tokens: 391,
    p50: 13.4,
    p95: 199.5,
    tone: 'plain',
  },
  {
    name: 'The base harness with the adapter',
    groups: [
      { passed: 6, of: 24, low: 12.0, high: 44.9 },
      { passed: 7, of: 30, low: 11.8, high: 40.9 },
    ],
    all: { passed: 13, of: 54, low: 14.6, high: 36.9 },
    tokens: 133,
    p50: 51.4,
    p95: 149.0,
    tone: 'plain',
  },
  {
    name: 'Inventory desk',
    groups: [
      { passed: 19, of: 24, low: 59.5, high: 90.8 },
      { passed: 22, of: 30, low: 55.6, high: 85.8 },
    ],
    all: { passed: 41, of: 54, low: 63.1, high: 85.4 },
    tokens: 357,
    p50: 55.5,
    p95: 200.2,
    tone: 'plain',
  },
  {
    name: 'Inventory desk with the adapter',
    groups: [
      { passed: 23, of: 24, low: 79.8, high: 99.3 },
      { passed: 32, of: 32, low: 89.3, high: 100 },
    ],
    all: { passed: 55, of: 56, low: 90.6, high: 99.7 },
    tokens: 149,
    p50: 14.4,
    p95: 73.6,
    tone: 'student',
  },
];

/** With the adapter against without it, on the tasks both arms took. Corvid Hill on Inventory desk is primary. */
export const ADAPTER_PAIRS: readonly FieldPair<LabGroupKey>[] = [
  {
    label: 'Inventory desk',
    group: 'corvid',
    n: 30,
    wins: 8,
    losses: 0,
    both: 22,
    neither: 0,
    diff: 26.7,
    low: 9.8,
    high: 44.4,
  },
  {
    label: 'Inventory desk',
    group: 'seen',
    n: 24,
    wins: 4,
    losses: 0,
    both: 19,
    neither: 1,
    diff: 16.7,
    low: -1.7,
    high: 36.1,
  },
  {
    label: 'Inventory desk',
    group: 'all',
    n: 54,
    wins: 12,
    losses: 0,
    both: 41,
    neither: 1,
    diff: 22.2,
    low: 10.4,
    high: 35.1,
  },
  {
    label: 'The base harness',
    group: 'corvid',
    n: 30,
    wins: 6,
    losses: 2,
    both: 1,
    neither: 21,
    diff: 13.3,
    low: -6.1,
    high: 32.1,
  },
  {
    label: 'The base harness',
    group: 'seen',
    n: 24,
    wins: 4,
    losses: 3,
    both: 2,
    neither: 15,
    diff: 4.2,
    low: -18.7,
    high: 26.6,
  },
  {
    label: 'The base harness',
    group: 'all',
    n: 54,
    wins: 10,
    losses: 5,
    both: 3,
    neither: 36,
    diff: 9.3,
    low: -5.3,
    high: 23.5,
  },
];

/**
 * The run's GPU spend, and the primary difference at Corvid Hill counted with the two base-arm
 * tasks that never ran as passed and as failed.
 */
export const ADAPTER_RUN = {
  gpuUsd: 4.42,
  ifPassed: { diff: 25.0, low: 9.1, high: 42.1 },
  ifFailed: { diff: 31.3, low: 14.2, high: 48.6 },
} as const;
