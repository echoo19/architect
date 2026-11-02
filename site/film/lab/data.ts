/**
 * What the film's screens show. Every figure is a measured one from the repository's reports,
 * with its source beside it; where nothing was measured the screen shows a dash, and the one
 * figure that is only the form of a sentence (the certificate) is marked as an example on screen.
 *
 * Sources: README.md, docs/comparisons/tutor-1.md (the academy field's first run),
 * docs/comparisons/tutor-1-local.md, docs/comparisons/returns-desk-2.md, docs/DECISIONS.md 078.
 */

export interface Specialist {
  name: string;
  /** Its job, in one line. */
  does: string;
  /** A measured result; none for the sample job, which has no test and says so. */
  figure?: { value: string; of: string; label: string };
}

/** The agents Architect made, as the opening shows them. */
export const SPECIALISTS: readonly Specialist[] = [
  {
    name: 'Returns desk',
    does: 'Refunds and exchanges',
    // returns-desk-2.md: 58 of 60 on the final test, on a new returns desk.
    figure: { value: '58', of: '60', label: 'final test' },
  },
  {
    // The sample job that ships with Architect, with no test: its card carries a Sample badge.
    name: 'Service desk',
    does: 'Invoices and bookings',
  },
  {
    name: 'Academy desk',
    does: 'Missed questions',
    // academy-desk-1.md: 43 of 48 at Harborview Prep, which neither model saw.
    figure: { value: '43', of: '48', label: 'never seen' },
  },
  {
    name: 'Pricing desk',
    does: 'Repair quotes',
    // README: 40 of 40 on its final test (a single run, not a planned comparison).
    figure: { value: '40', of: '40', label: 'final test' },
  },
];

export const ACADEMY = 'Academy desk';

export interface Organization {
  name: string;
  kind: 'Generated' | 'Real';
  role: 'Taught on' | 'Never seen';
  files: number;
  rows?: number;
}

/** The academy field's organizations in its first run (tutor-1.md; counts from the run's folders). */
export const ORGANIZATIONS: readonly Organization[] = [
  { name: 'Ridgeline Test Prep', kind: 'Generated', role: 'Taught on', files: 12, rows: 2180 },
  { name: 'Wrenfield Prep', kind: 'Generated', role: 'Taught on', files: 12, rows: 1923 },
  { name: 'Lakemont Scholars', kind: 'Generated', role: 'Taught on', files: 12, rows: 2024 },
  { name: 'Harborview Prep', kind: 'Generated', role: 'Never seen', files: 12 },
  { name: 'Real academy', kind: 'Real', role: 'Never seen', files: 12 },
];

/** Ridgeline's files, by rows (the run's own copy of the academy). */
export const RIDGELINE_FILES: readonly (readonly [string, string])[] = [
  ['policy.md', '4 KB'],
  ['students.csv', '16 rows'],
  ['topics.csv', '12 rows'],
  ['errors.csv', '43 rows'],
  ['hints.csv', '44 rows'],
  ['questions.csv', '288 rows'],
  ['tests.csv', '120 rows'],
  ['attempts.csv', '1,608 rows'],
];

/**
 * The first run's locked test, passed out of tasks, with 95% Wilson intervals (tutor-1.md, "Per
 * arm and group"). On each never-seen group, the paired difference of taught minus Glimmer alone,
 * with its 95% interval (academy-desk-1.md, "Paired results").
 */
export const LOCKED = {
  groups: [
    {
      label: 'Academies taught on, 48',
      rows: [
        { id: 'bare', label: 'Glimmer alone', estimate: 0.438, low: 0.307, high: 0.577 },
        { id: 'draft', label: 'One-shot setup', estimate: 0.458, low: 0.326, high: 0.597 },
        { id: 'taught', label: 'Taught by Spark', estimate: 0.917, low: 0.804, high: 0.967 },
      ],
    },
    {
      label: 'Harborview Prep, never seen, 48',
      difference: { text: '+39.6 points', tip: '95% interval +22.9 to +53.7: a gain.' },
      rows: [
        { id: 'bare', label: 'Glimmer alone', estimate: 0.5, low: 0.364, high: 0.636 },
        { id: 'draft', label: 'One-shot setup', estimate: 0.458, low: 0.326, high: 0.597 },
        { id: 'taught', label: 'Taught by Spark', estimate: 0.896, low: 0.778, high: 0.955 },
      ],
    },
    {
      label: 'Real academy, never seen, 24',
      difference: {
        text: '+12.5 points',
        tip: '95% interval -17.9 to +40.2.',
      },
      rows: [
        { id: 'bare', label: 'Glimmer alone', estimate: 0.375, low: 0.212, high: 0.573 },
        { id: 'draft', label: 'One-shot setup', estimate: 0.458, low: 0.279, high: 0.649 },
        { id: 'taught', label: 'Taught by Spark', estimate: 0.5, low: 0.314, high: 0.686 },
      ],
    },
  ],
} as const;

export interface Round {
  number: string;
  title: string;
  /** Check-task score before and after, in percent of 36 (tutor-1.md, "What the three rounds changed"). */
  before: number;
  after: number;
  kept: boolean;
}

export const ROUNDS: readonly Round[] = [
  {
    number: '01',
    title: 'Look questions up instead of reading the bank',
    before: 47,
    after: 69,
    kept: true,
  },
  {
    number: '02',
    title: 'Read the practice count from the policy',
    before: 67,
    after: 64,
    kept: false,
  },
  { number: '03', title: 'A helper for the policy numbers', before: 67, after: 97, kept: true },
];

/**
 * The team demo at Fenwick Screening Core (examples/inventory-desk/README.md, "The team demo with
 * the Assay desk"), as the team chat shows it (apps/desktop/e2e/fixtures-teams.ts and
 * docs/screenshots/team-*.png). Inventory desk leads and asks Assay desk. The values are the
 * examples' own: fenwick-plate_report-01 in examples/assay-desk, fenwick-reserve-01 in
 * examples/inventory-desk, and Fenwick's retests.csv (5 rows) and reservations.csv (162 rows).
 */
export const TEAM = {
  name: 'Screening logistics',
  lead: 'Inventory desk',
  teammate: 'Assay desk',
  org: 'Fenwick Screening Core',
  chat: "Reserve stock for FW-0418's re-tests",
  request: "Reserve stock for FW-0418's re-tests.",
  asked: 'Which compounds on plate FW-0418 need a re-test, and why? Queue them in retests.csv.',
  code: "const plate = wells('FW-0418');",
  output: ['0.7689', 'FWC-13399 INCONCLUSIVE', 'FWC-13444 BORDERLINE'],
  answer:
    'FW-0418 passes QC (Z′ 0.7689). 2 compounds need a re-test: FWC-13399 is inconclusive and FWC-13444 is borderline. I queued them as RT-0006 and RT-0007.',
  reply: 'FW-0418 passed QC, and Assay desk queued its 2 re-tests.',
  allocations: [
    {
      compound: 'FWC-13399',
      text: "nothing usable (LOW-VOLUME). None of its 3 lots has 20 µL free, and Fenwick doesn't combine lots.",
    },
    {
      compound: 'FWC-13444',
      text: '20 µL from lot FL-04159 in rack VR-06:E08. It expires on 2026-12-07, the first of its usable lots, and the hold below is for it.',
    },
  ],
  hold: {
    columns: ['reservation_id', 'compound_id', 'lot', 'amount', 'reserved_on'],
    row: ['HOLD-0163', 'FWC-13444', 'FL-04159', '20 µL', '2026-10-14'],
  },
} as const;
