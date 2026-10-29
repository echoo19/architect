/*
 * Words from the records, as plain text. A reason the loop stored says "Dev 30/45" then an arrow
 * then "35/45", and a title the mentor wrote may hold a dash or a curly quote; the report is read
 * in tools with other encodings, where those marks turn into garbage. The records stay as they
 * are, and the report says the same in ASCII. The marks are written as code point escapes here so
 * that this file holds none of them itself.
 */

const PLAIN: readonly (readonly [RegExp, string])[] = [
  // Rightward arrows, with the space around them, so an arrow between two scores reads "to".
  [/\s*[\u{2192}\u{21D2}]\s*/gu, ' to '],
  // En and em dashes.
  [/[\u{2013}\u{2014}]/gu, '-'],
  // Curly single and double quotes.
  [/[\u{2018}\u{2019}]/gu, "'"],
  [/[\u{201C}\u{201D}]/gu, '"'],
  // The ellipsis and the no-break space.
  [/\u{2026}/gu, '...'],
  [/\u{A0}/gu, ' '],
];

/** The text with arrows written as "to" and typographic dashes, quotes and dots as ASCII. */
export function plainText(text: string): string {
  return PLAIN.reduce((plain, [mark, instead]) => plain.replace(mark, instead), text);
}

/** The same object with `plainText` applied to every string in it, however deep. */
export function plainStrings<T>(value: T): T {
  if (typeof value === 'string') return plainText(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => plainStrings(item)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, plainStrings(item)]),
    ) as T;
  }
  return value;
}
