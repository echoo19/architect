import { cleanText, currencyCodes, currencySigns } from '../values';

/*
 * Which currency a cell says its amount is in, when it says. A rule declares the one currency its
 * amounts are in; a cell that names another is an error for its row, and a column that names
 * several is refused, because adding euros to dollars gives no amount of either.
 *
 * Marks outside ASCII are written as code point escapes, so they can be seen in this file.
 */

const DOLLARS = ['USD', 'CAD', 'AUD', 'NZD', 'MXN'];

/** The currencies a sign can stand for. A dollar sign alone does not say which dollar. */
const SIGNS: Readonly<Record<string, readonly string[]>> = {
  $: DOLLARS,
  '\u{a2}': DOLLARS,
  '\u{a3}': ['GBP'],
  '\u{a5}': ['JPY', 'CNY'],
  '\u{20a9}': ['KRW'],
  '\u{20ac}': ['EUR'],
  '\u{20b9}': ['INR'],
  '\u{20bd}': ['RUB'],
};

/**
 * What each currency sign or code in a cell could stand for, one set per mark. The marks are the
 * ones `parseDecimal` takes off a number, so a cell it reads always has its currency checked.
 */
export function marksIn(cell: string | null | undefined): (readonly string[])[] {
  const text = cleanText(cell);
  const marks: (readonly string[])[] = [];
  for (const sign of text.matchAll(currencySigns())) {
    const meant = SIGNS[sign[0]];
    if (meant !== undefined) marks.push(meant);
  }
  for (const code of text.matchAll(currencyCodes())) marks.push([code[1]?.toUpperCase() ?? '']);
  return marks;
}

/** The currencies every mark could stand for at once; empty when they disagree. */
export function agreed(marks: readonly (readonly string[])[]): string[] {
  const [first, ...rest] = marks;
  if (first === undefined) return [];
  return first.filter((code) => rest.every((others) => others.includes(code)));
}

/** Whether a cell's marks, if it has any, fit the currency a rule declared. */
export function fits(cell: string | null | undefined, currency: string): boolean {
  const marks = marksIn(cell);
  return marks.length === 0 || agreed(marks).includes(currency);
}

const NAMES: Readonly<Record<string, string>> = {
  USD: 'US dollars',
  CAD: 'Canadian dollars',
  AUD: 'Australian dollars',
  NZD: 'New Zealand dollars',
  MXN: 'Mexican pesos',
  EUR: 'euros',
  GBP: 'pounds',
  JPY: 'yen',
  CNY: 'yuan',
  CHF: 'Swiss francs',
  INR: 'rupees',
  KRW: 'won',
  RUB: 'rubles',
};

/** The currency's name for a sentence, or its code. */
export function currencyName(code: string): string {
  return NAMES[code] ?? code;
}
