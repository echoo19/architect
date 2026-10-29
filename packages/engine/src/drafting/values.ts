import type { DateOrder } from '@architect/shared';

/*
 * Reading the cells of a messy export the same way every time: stray spaces, quotes, letter case,
 * currency signs, thousands separators and dates in several styles. Nothing here guesses beyond a
 * fixed rule, and a cell that doesn't fit a rule is reported as unreadable, never made up.
 *
 * Marks outside ASCII are written as code point escapes, so they can be seen in this file.
 */

/** Zero-width marks and the soft hyphen, which copy and paste leave in cells. */
const INVISIBLE = /[\u{200b}-\u{200d}\u{2060}\u{feff}\u{ad}]/gu;

/** Pairs of marks a cell may be wrapped in: straight quotes, curly quotes, low quotes, guillemets. */
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ['\u{201c}', '\u{201d}'],
  ['\u{2018}', '\u{2019}'],
  ['\u{201e}', '\u{201c}'],
  ['\u{ab}', '\u{bb}'],
];

function withoutQuotes(text: string): string {
  if (text.length < 2) return text;
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }
  return text;
}

/**
 * A cell as a person would read it: compatibility forms and odd spaces made plain, runs of spaces
 * made one, wrapping quotes taken off. An empty cell is the empty string.
 */
export function cleanText(cell: string | null | undefined): string {
  if (cell === null || cell === undefined) return '';
  let text = cell.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = withoutQuotes(text).replace(/\s+/g, ' ');
    if (stripped === text) break;
    text = stripped;
  }
  return text;
}

/** What two cells are compared by: the same text however it is spaced, quoted or cased. */
export function foldKey(cell: string | null | undefined): string {
  return cleanText(cell).toLowerCase();
}

/** A text cleaned and, when longer than `width`, cut at a word and ended with "...". */
export function briefly(text: string, width: number): string {
  const cleaned = cleanText(text);
  if (cleaned.length <= width) return cleaned;
  const cut = cleaned.slice(0, width - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > width / 2 ? cut.slice(0, space) : cut).trim()}...`;
}

/** Marks that files put where a number or a date is missing: n/a, null, a dash, a question mark. */
const BLANK_MARKS = /^(?:n\/a|n\.a\.|na|nan|null|nil|none|-+|\?+|\u{2013}|\u{2014})$/iu;

/** A cell with nothing in it, or only a mark that stands for nothing, in a column of numbers or dates. */
export function isBlank(cell: string | null | undefined): boolean {
  const text = cleanText(cell);
  return text === '' || BLANK_MARKS.test(text);
}

/**
 * The mark a cell holds where a number should be (N/A, a dash and the other forms `isBlank` knows),
 * cleaned, or null for a cell with a number or words in it. A cell with nothing in it holds no
 * mark: it is empty, which is a different thing to say. Two cells hold the same mark when `foldKey`
 * reads them alike, so N/A and n/a are one.
 */
export function markOf(cell: string | null | undefined): string | null {
  const text = cleanText(cell);
  return text !== '' && BLANK_MARKS.test(text) ? text : null;
}

/** A number written out exactly: `units` hundredths when `places` is 2. */
export interface Decimal {
  readonly units: bigint;
  readonly places: number;
}

/** The most digits after the point a cell may have. */
const MAX_PLACES = 8;

/**
 * The currencies Architect knows by their ISO code and by their sign, in one place so that the
 * reading of a number and the check of a rule's currency can't disagree about what a mark is.
 * The signs are dollar, cent, pound, yen, won, euro, rupee and ruble.
 */
export const CURRENCY_CODE_LIST = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'JPY',
  'CHF',
  'CNY',
  'INR',
  'MXN',
  'KRW',
  'RUB',
] as const;
export const CURRENCY_SIGN_CHARS = '$\u{a2}\u{a3}\u{a5}\u{20a9}\u{20ac}\u{20b9}\u{20bd}';

/** Every currency sign and every currency code in a text, each a pattern of its own to match with. */
export const currencySigns = (): RegExp => new RegExp(`[${CURRENCY_SIGN_CHARS}]`, 'gu');
export const currencyCodes = (): RegExp =>
  new RegExp(`\\b(${CURRENCY_CODE_LIST.join('|')})\\b`, 'gi');
/** A hyphen or a true minus sign. */
const SIGN_BEFORE = /^[-\u{2212}]\s*/u;
const SIGN_AFTER = /\s*[-\u{2212}]$/u;
/** Groups of three digits set apart by a space, a thin space or an apostrophe. */
const SPACED_GROUPS = /^\d{1,3}(?:[ '\u{2019}]\d{3})+(?:[.,]\d+)?$/u;
const GROUP_GAP = /(?<=\d)[ '\u{2019}](?=\d{3})/gu;

/** Digits before and after the point, as one of the forms a number is written in. */
function splitNumber(text: string): { integer: string; fraction: string } | null {
  const forms: readonly [
    RegExp,
    (found: RegExpExecArray) => { integer: string; fraction: string },
  ][] = [
    // 1234
    [/^(\d+)$/, (found) => ({ integer: found[1] ?? '', fraction: '' })],
    // 12.5 and .5
    [/^(\d*)\.(\d+)$/, (found) => ({ integer: found[1] || '0', fraction: found[2] ?? '' })],
    // 12.
    [/^(\d+)\.$/, (found) => ({ integer: found[1] ?? '', fraction: '' })],
    // 1,234 and 1,234.50
    [
      /^(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/,
      (found) => ({ integer: (found[1] ?? '').replaceAll(',', ''), fraction: found[2] ?? '' }),
    ],
    // 1.234,50
    [
      /^(\d{1,3}(?:\.\d{3})+),(\d+)$/,
      (found) => ({ integer: (found[1] ?? '').replaceAll('.', ''), fraction: found[2] ?? '' }),
    ],
    // 12,5 and 12,50
    [/^(\d+),(\d{1,2})$/, (found) => ({ integer: found[1] ?? '', fraction: found[2] ?? '' })],
  ];
  for (const [form, read] of forms) {
    const found = form.exec(text);
    if (found) return read(found);
  }
  return null;
}

/**
 * The number a cell spells, or null. A currency sign or code, a sign in front or behind or
 * brackets for a negative, and thousands separators (commas, or points with a decimal comma, or
 * spaces) are all read. `1,234` is one thousand two hundred thirty-four and `12,5` is twelve and a
 * half; a lone point is always a decimal point, so `1.234` is a little over one.
 */
export function parseDecimal(cell: string | null | undefined): Decimal | null {
  let text = cleanText(cell);
  if (text === '') return null;
  let negative = false;
  const bracketed = /^\((.*)\)$/.exec(text);
  if (bracketed) {
    negative = true;
    text = (bracketed[1] ?? '').trim();
  }
  text = text.replace(currencyCodes(), '').replace(currencySigns(), '').trim();
  if (SIGN_BEFORE.test(text)) {
    negative = true;
    text = text.replace(SIGN_BEFORE, '');
  } else if (SIGN_AFTER.test(text)) {
    negative = true;
    text = text.replace(SIGN_AFTER, '');
  }
  text = text.replace(/^\+\s*/, '');
  if (SPACED_GROUPS.test(text)) text = text.replace(GROUP_GAP, '');
  const parts = splitNumber(text);
  if (parts === null || parts.fraction.length > MAX_PLACES) return null;
  const units = BigInt(`${parts.integer}${parts.fraction}`);
  return { units: negative ? -units : units, places: parts.fraction.length };
}

/** The sum of numbers written with different numbers of places, exactly. */
export function sumDecimals(values: readonly Decimal[]): Decimal {
  const places = values.reduce((most, value) => Math.max(most, value.places), 0);
  let units = 0n;
  for (const value of values) units += value.units * 10n ** BigInt(places - value.places);
  return { units, places };
}

/** The digits of a decimal with a point where it belongs, and no more places than it needs. */
export function decimalToString(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.places + 1, '0');
  const cut = digits.length - value.places;
  const whole = digits.slice(0, cut);
  const fraction = digits.slice(cut).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

/** A decimal as the nearest JavaScript number, read from its exact digits. */
export function decimalToNumber(value: Decimal): number {
  return Number(decimalToString(value));
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAY = /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i;
/** A time of day after a date, which a day doesn't need: `T13:05:00Z`, ` 1:05 PM`. */
const TIME =
  '(?:[T\\s]\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?\\s*(?:[AP]M)?\\s*(?:Z|[+-]\\d{2}:?\\d{2})?)?';
const YEAR_FIRST = new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${TIME}$`, 'i');
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
const YEAR_LAST = new RegExp(`^(\\d{1,2})([-/.])(\\d{1,2})[-/.](\\d{4}|\\d{2})${TIME}$`, 'i');
const MONTH_NAME_FIRST = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i;
const DAY_THEN_MONTH_NAME = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?[\s-]+(\d{4}|\d{2})$/i;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` when the three numbers make a day on the calendar, else null. */
function calendarDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || year < 1000 || year > 9999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function fullYear(text: string): number {
  const year = Number(text);
  if (text.length === 4) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

/**
 * The day a cell names, as `YYYY-MM-DD`, or null. Understood: `2026-11-24` (a time after it is
 * ignored), `2026/11/24`, `20261124`, `11/24/2026` or `24/11/2026` read as `order` says, with
 * points always day first, `Nov 24, 2026`, `24 November 2026` and a weekday in front.
 */
export function parseDay(cell: string | null | undefined, order: DateOrder): string | null {
  const text = cleanText(cell).replace(WEEKDAY, '');
  if (text === '') return null;

  let found = YEAR_FIRST.exec(text) ?? COMPACT.exec(text);
  if (found) return calendarDay(Number(found[1]), Number(found[2]), Number(found[3]));

  found = YEAR_LAST.exec(text);
  if (found) {
    const first = Number(found[1]);
    const second = Number(found[3]);
    const year = fullYear(found[4] ?? '');
    const dayFirst = order === 'day_first' || found[2] === '.';
    return dayFirst ? calendarDay(year, second, first) : calendarDay(year, first, second);
  }

  found = MONTH_NAME_FIRST.exec(text);
  if (found) {
    const month = MONTHS[(found[1] ?? '').toLowerCase()];
    return month === undefined ? null : calendarDay(Number(found[3]), month, Number(found[2]));
  }
  found = DAY_THEN_MONTH_NAME.exec(text);
  if (found) {
    const month = MONTHS[(found[2] ?? '').toLowerCase()];
    return month === undefined
      ? null
      : calendarDay(fullYear(found[3] ?? ''), month, Number(found[1]));
  }
  return null;
}

/**
 * What the cells of a date column say about the order of day and month in numbers like
 * `03/04/2026`: a first number over 12 can only be a day, and so can a second one.
 */
export function dateOrderEvidence(cells: Iterable<string | null>): {
  dayFirst: boolean;
  monthFirst: boolean;
  /** Numeric dates whose two numbers could be read either way. */
  ambiguous: number;
} {
  const seen = { dayFirst: false, monthFirst: false, ambiguous: 0 };
  for (const cell of cells) {
    const found = YEAR_LAST.exec(cleanText(cell).replace(WEEKDAY, ''));
    if (!found || found[2] === '.') continue;
    const first = Number(found[1]);
    const second = Number(found[3]);
    if (first > 12 && second <= 12) seen.dayFirst = true;
    else if (second > 12 && first <= 12) seen.monthFirst = true;
    else if (first <= 12 && second <= 12 && first !== second) seen.ambiguous += 1;
  }
  return seen;
}

const DAY_MS = 86_400_000;

/** The day's number since 1970, for counting between days. */
export function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/** The day that many days after the one given, as `YYYY-MM-DD`. */
export function addDays(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
}
