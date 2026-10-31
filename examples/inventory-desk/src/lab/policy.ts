import { writeDate } from '@architect/example-assay-desk';
import type { DateForm } from '@architect/example-assay-desk';
import type { Unit } from './volume';
import { UNIT_TEXT, writeVolume } from './volume';

/**
 * A lab's rules for drawing compound stock for a re-test, and its policy.md. Every lab has the
 * same kinds of rule with its own numbers and words, written one of three ways: prose with the
 * numbers in a table at the end (`table`), prose alone with some numbers in words (`prose`), or a
 * short list of rules (`bullets`). The reference reads them back from any of the three
 * (`readPolicy` in src/reference/policy.ts).
 */

export type PolicyStyle = 'table' | 'prose' | 'bullets';
export const POLICY_STYLES: readonly PolicyStyle[] = ['table', 'prose', 'bullets'];

export interface Policy {
  /** The unit the lab writes its volumes in. */
  unit: Unit;
  /** How the lab writes a date. */
  dateForm: DateForm;
  /** Nanolitres of stock one re-test takes. */
  minimum: number;
  /** A lot is in date for a re-test when it expires at least this many days after the request. */
  cutoff: number;
  /** `expiry`: the usable lot that expires first. `largest`: the one with the most free volume. */
  choose: 'expiry' | 'largest';
  /** Whether one re-test may be made up from several lots. */
  combine: boolean;
  /** A compound with this many reservations already gets no new one. */
  maxHolds: number;
  /** The reason codes for a compound with nothing to draw. */
  codes: { expired: string; low: string; limit: string };
}

/** The rows of the table at the end of a `table` policy. */
export const POLICY_SETTINGS = {
  unit: 'Quantities written in',
  dateForm: 'Dates written as',
  minimum: 'Stock per re-test',
  cutoff: 'Days a lot must have left before it expires, at least',
  choose: 'Lot to draw from first',
  combine: 'Combine lots for one re-test',
  maxHolds: 'Reservations per compound, at most',
  expired: 'Reason code, no lot in date',
  low: 'Reason code, too little stock',
  limit: 'Reason code, reservation limit reached',
} as const;

/** How a policy names each date form. */
export const DATE_FORMS: Record<DateForm, string> = {
  iso: 'year-month-day',
  us: 'month/day/year',
  dmy: 'day-month-year',
};

/** How a policy names each way of choosing a lot. */
export const CHOICES: Record<Policy['choose'], string> = {
  expiry: 'the lot that expires first',
  largest: 'the lot with the most free volume',
};

/** Small numbers as a policy written in prose spells them. */
export const NUMBER_WORDS: Readonly<Record<number, string>> = {
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  14: 'fourteen',
  21: 'twenty-one',
  30: 'thirty',
  60: 'sixty',
};

function word(n: number): string {
  const spelled = NUMBER_WORDS[n];
  if (spelled === undefined) throw new Error(`No word for ${n}`);
  return spelled;
}

export function policyDocument(
  name: string,
  today: string,
  policy: Policy,
  style: PolicyStyle,
): string {
  const write = { table: tablePolicy, prose: prosePolicy, bullets: bulletPolicy }[style];
  return `${write(name, today, policy).join('\n')}\n`;
}

const FILES = [
  '- `inventory.csv`: one row per lot of every compound we hold: compound_id, lot, location, quantity (what is left in the vial or well), conc_mm, received and expires.',
  '- `reservations.csv`: stock already held for work not yet run, one row per lot held: reservation_id, compound_id, lot, amount, reserved_on. New reservations go at the end.',
];

const FREE =
  "A lot's free volume is its quantity less every amount reservations.csv holds on that lot.";

const UNITS_NOTE =
  'A quantity is written with its unit, µL, mL or nL (1 mL = 1,000 µL = 1,000,000 nL); most rows use ours, some older ones another.';

function dateText(policy: Policy, today: string): string {
  return `${DATE_FORMS[policy.dateForm]}, as ${writeDate(today, policy.dateForm)}`;
}

function usableText(policy: Policy, minimum: string): string {
  return policy.combine
    ? `A re-test may be made up from several lots. Every lot that is in date and has free volume is usable; take from them in order, everything free from each until the re-test has ${minimum}, and from the last only what is still needed.`
    : `A re-test comes from a single lot. A lot is usable when it is in date and has at least ${minimum} free; draw ${minimum} from the first usable lot.`;
}

function nothingText(policy: Policy): string {
  return `First, whether a re-test can be drawn at all: a compound that has no lot in date gets reason ${policy.codes.expired}; one with lots in date that can't make up a re-test gets reason ${policy.codes.low}.`;
}

/** The limit counts the rows the re-test would add, one per lot drawn, with those already held. */
function limitText(policy: Policy, most: string): string {
  return `A re-test that can be drawn is allocated and reserved only if the compound's rows in reservations.csv, with one new row for each lot drawn, come to no more than ${most}; otherwise it gets reason ${policy.codes.limit} and no row.`;
}

const ROWS =
  'New rows in reservations.csv: reservation_id numbered on from the last row, compound_id, lot, amount (in our unit, the number and the unit, as the file writes them), and reserved_on, the day of the request written the way we write dates. One row per lot drawn from, and none for a compound with nothing to draw.';

function tablePolicy(name: string, today: string, policy: Policy): string[] {
  const rows: [string, string][] = [
    [POLICY_SETTINGS.unit, UNIT_TEXT[policy.unit]],
    [POLICY_SETTINGS.dateForm, dateText(policy, today)],
    [POLICY_SETTINGS.minimum, writeVolume(policy.minimum, policy.unit)],
    [POLICY_SETTINGS.cutoff, String(policy.cutoff)],
    [POLICY_SETTINGS.choose, CHOICES[policy.choose]],
    [POLICY_SETTINGS.combine, policy.combine ? 'yes' : 'no'],
    [POLICY_SETTINGS.maxHolds, String(policy.maxHolds)],
    [POLICY_SETTINGS.expired, policy.codes.expired],
    [POLICY_SETTINGS.low, policy.codes.low],
    [POLICY_SETTINGS.limit, policy.codes.limit],
  ];
  return [
    `# ${name}: drawing stock for a re-test`,
    '',
    'How we decide which lot of a compound a re-test comes from, and how we hold it. The numbers are in the table at the end.',
    '',
    '## Our records',
    '',
    ...FILES,
    '',
    UNITS_NOTE,
    '',
    '## What can be used',
    '',
    `${FREE} A lot is in date for a re-test when it expires at least the days in the table after the day of the request; a lot that expires sooner, or has expired, is not used.`,
    '',
    policy.combine
      ? 'When the table says lots may be combined, a re-test may be made up from several lots: every lot that is in date and has free volume is usable. Take from them in order, everything free from each until the re-test has its stock, and from the last only what is still needed.'
      : 'When the table says lots are not combined, a re-test comes from a single lot: a lot is usable when it is in date and has at least the stock per re-test free. Draw the stock per re-test from the first usable lot.',
    '',
    'The lots go in the order the table says to draw from: the one that expires first, or the one with the most free volume. How much of a compound is usable is the free volume of its usable lots together.',
    '',
    '## Reservations',
    '',
    "First, whether a re-test can be drawn at all: a compound with no lot in date gets the no-lot-in-date code, and one with lots in date that cannot make up a re-test gets the too-little code. A re-test that can be drawn is allocated and reserved only if the compound's rows in reservations.csv, with one new row for each lot drawn, come to no more than the reservations per compound in the table; otherwise it gets the reservation-limit code and no row.",
    '',
    ROWS,
    '',
    '| Setting | Value |',
    '| --- | --- |',
    ...rows.map(([setting, value]) => `| ${setting} | ${value} |`),
  ];
}

function prosePolicy(name: string, today: string, policy: Policy): string[] {
  const minimum = writeVolume(policy.minimum, policy.unit);
  return [
    `# How ${name} draws stock for a re-test`,
    '',
    'This is how we pick the lot of a compound a re-test comes from, and how we hold it until the plate is run.',
    '',
    ...FILES,
    '',
    `We write quantities in ${UNIT_TEXT[policy.unit]}. ${UNITS_NOTE} Dates are written ${dateText(policy, today)}.`,
    '',
    `Each re-test takes ${minimum} of stock. ${FREE} A lot is in date for a re-test only when it expires at least ${word(policy.cutoff)} days after the day of the request.`,
    '',
    `${usableText(policy, minimum)} We draw from ${CHOICES[policy.choose]} first. How much of a compound is usable is the free volume of its usable lots together.`,
    '',
    `${nothingText(policy)} ${limitText(policy, word(policy.maxHolds))}`,
    '',
    ROWS,
  ];
}

function bulletPolicy(name: string, today: string, policy: Policy): string[] {
  const minimum = writeVolume(policy.minimum, policy.unit);
  return [
    `# ${name} stock rules`,
    '',
    ...FILES,
    '',
    `- Quantities: in ${UNIT_TEXT[policy.unit]}. ${UNITS_NOTE}`,
    `- Dates: ${dateText(policy, today)}.`,
    `- Each re-test takes ${minimum}.`,
    `- ${FREE}`,
    `- In date: the lot expires at least ${policy.cutoff} days after the day of the request.`,
    `- ${usableText(policy, minimum)}`,
    `- Draw from ${CHOICES[policy.choose]} first.`,
    '- Usable: the free volume of the usable lots together.',
    `- ${nothingText(policy)}`,
    `- Limit: ${limitText(policy, String(policy.maxHolds))}`,
    `- ${ROWS}`,
  ];
}
