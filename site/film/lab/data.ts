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
  does: string;
  /** A measured result, or none. */
  figure?: { value: string; of?: string; label: string };
}

/** The agents Architect made, as the opening shows them. */
export const SPECIALISTS: readonly Specialist[] = [
  {
    name: 'Returns desk',
    does: 'Refunds, exchanges and carrier pickups for an outdoor gear shop.',
    // returns-desk-2.md: 58 of 60 on the final test, on a new returns desk.
    figure: { value: '58', of: '60', label: 'on a final test it never saw' },
  },
  {
    name: 'Service desk',
    does: 'Invoices, overdue balances and technician bookings for a home services company.',
  },
  {
    name: 'Academy desk',
    does: 'Diagnoses missed questions, sets practice and flags students for staff.',
    // tutor-1.md: 43 of 48 at Harborview Prep, which neither model saw.
    figure: { value: '43', of: '48', label: 'at an academy it never saw' },
  },
  {
    name: 'Pricing desk',
    does: "Repair quotes from a shop's price list and policy, drafted by Spark from its files.",
    // README: 40 of 40 on its final test (a single run, not a planned comparison).
    figure: { value: '40', of: '40', label: 'on its final test' },
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
 * arm and group").
 */
export const LOCKED = {
  groups: [
    {
      label: 'Academies it was taught on (48 tasks)',
      rows: [
        { id: 'bare', label: 'Glimmer alone', estimate: 0.438, low: 0.307, high: 0.577 },
        { id: 'draft', label: 'One-shot setup', estimate: 0.458, low: 0.326, high: 0.597 },
        { id: 'taught', label: 'Taught by Spark', estimate: 0.917, low: 0.804, high: 0.967 },
      ],
    },
    {
      label: 'Harborview Prep, never seen (48)',
      rows: [
        { id: 'bare', label: 'Glimmer alone', estimate: 0.5, low: 0.364, high: 0.636 },
        { id: 'draft', label: 'One-shot setup', estimate: 0.458, low: 0.326, high: 0.597 },
        { id: 'taught', label: 'Taught by Spark', estimate: 0.896, low: 0.778, high: 0.955 },
      ],
    },
    {
      label: 'Real academy, never seen (24)',
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
