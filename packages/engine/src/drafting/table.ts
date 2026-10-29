import type { DateOrder } from '@architect/shared';
import { parseCsv } from '../data/csv';
import type { Row } from '../data/types';
import {
  cleanText,
  dateOrderEvidence,
  foldKey,
  isBlank,
  parseDay,
  parseDecimal,
  type Decimal,
} from './values';

/** A CSV file read for drafting: its header and every row, every cell still as text. */
export interface Table {
  /** The file's name in the job. */
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
}

/** The most rows a table may have, so one file can't use up the engine's memory. */
export const MAX_ROWS = 200_000;

/**
 * Reads a CSV file. A file that isn't comma-separated, or whose rows don't all have as many
 * cells as the header, is refused with a sentence the person can act on.
 */
export function readTable(name: string, text: string): Table {
  const header = text.replace(/^\u{feff}/u, '').split(/\r?\n/, 1)[0] ?? '';
  if (!header.includes(',') && /[;\t|]/.test(header)) {
    const mark = header.includes(';') ? 'semicolons' : header.includes('\t') ? 'tabs' : 'bars';
    throw new Error(
      `${name} separates its columns with ${mark}. Architect reads CSV files with commas. Save it again as a comma-separated file and attach that.`,
    );
  }
  let parsed;
  try {
    parsed = parseCsv(name, text);
  } catch (error) {
    throw new Error(
      `${name} isn't a clean CSV file. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    throw new Error(
      `${name} has ${parsed.rows.length.toLocaleString('en-US')} rows, more than the ${MAX_ROWS.toLocaleString('en-US')} Architect reads. Attach a smaller part of it.`,
    );
  }
  return { name, columns: parsed.columns, rows: parsed.rows };
}

/**
 * The header a name stands for: the exact spelling when there is one, else the one column that is
 * the same without regard to case, spacing or quotes. Null when the table has no such column, or
 * two that the name fits equally.
 */
export function findColumn(table: Table, wanted: string): string | null {
  if (table.columns.includes(wanted)) return wanted;
  const key = foldKey(wanted);
  const matches = table.columns.filter((column) => foldKey(column) === key);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function cellsOf(table: Table, column: string): (string | null)[] {
  return table.rows.map((row) => row[column] ?? null);
}

/** What a column holds, judged from its filled cells. */
export type ColumnKind = 'number' | 'date' | 'text';

/** The share of a column's filled cells that must read as a number or a date to call it one. */
const KIND_SHARE = 0.9;

/**
 * Whether a column holds numbers, dates or words. A column is numbers or dates when nine in ten
 * of its filled cells read as such; the rest are the file's mess, which the caller treats cell by
 * cell. Dates are read month first here, which only decides the guess.
 */
export function kindOf(cells: readonly (string | null)[]): ColumnKind {
  let filled = 0;
  let numbers = 0;
  let dates = 0;
  for (const cell of cells) {
    if (isBlank(cell)) continue;
    filled += 1;
    if (parseDecimal(cell) !== null) numbers += 1;
    else if (parseDay(cell, 'month_first') !== null || parseDay(cell, 'day_first') !== null) {
      dates += 1;
    }
  }
  if (filled === 0) return 'text';
  if (numbers / filled >= KIND_SHARE) return 'number';
  if ((dates + numbers) / filled >= KIND_SHARE && dates > 0) return 'date';
  return 'text';
}

/**
 * Whether the filled cells of a column named as holding dates read as dates, nine in ten at least
 * (the rest is the file's mess, which the caller treats cell by cell). It looks at the cells as
 * dates and nothing else, since `kindOf` takes a column of 20260131 and the like for numbers.
 */
export function readsAsDates(cells: readonly (string | null)[]): boolean {
  let filled = 0;
  let dates = 0;
  for (const cell of cells) {
    if (isBlank(cell)) continue;
    filled += 1;
    if (parseDay(cell, 'month_first') !== null || parseDay(cell, 'day_first') !== null) dates += 1;
  }
  return filled > 0 && dates / filled >= KIND_SHARE;
}

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  filled: number;
  empty: number;
  /** Different values, counted without regard to case or spacing, up to `DISTINCT_CAP`. */
  distinct: number;
  distinctCapped: boolean;
  /** Every cell is filled and no two are the same. */
  unique: boolean;
  /** Some numbers are written with a currency sign, or with separators or brackets. */
  decorated: boolean;
}

export const DISTINCT_CAP = 1_000;
const EXAMPLES = 5;
const FEW_VALUES = 12;
const EXAMPLE_WIDTH = 40;

function shortened(text: string): string {
  return text.length > EXAMPLE_WIDTH ? `${text.slice(0, EXAMPLE_WIDTH - 1)}...` : text;
}

/** What a column holds, counted: nothing of any one row, so it can be said to anyone. */
export function profileColumn(table: Table, column: string): ColumnProfile {
  const cells = cellsOf(table, column);
  const distinct = new Set<string>();
  let empty = 0;
  let capped = false;
  let decorated = false;
  for (const cell of cells) {
    const text = cleanText(cell);
    if (text === '') {
      empty += 1;
      continue;
    }
    const key = text.toLowerCase();
    if (!distinct.has(key)) {
      if (distinct.size < DISTINCT_CAP) distinct.add(key);
      else capped = true;
    }
    if (!decorated && !/^[+-]?\d+(?:\.\d+)?$/.test(text) && parseDecimal(text) !== null) {
      decorated = true;
    }
  }
  const kind = kindOf(cells);
  return {
    name: column,
    kind,
    filled: cells.length - empty,
    empty,
    distinct: distinct.size,
    distinctCapped: capped,
    unique: empty === 0 && !capped && distinct.size === cells.length,
    decorated: kind === 'number' && decorated,
  };
}

/**
 * A few values of a column, as the file writes them, to show the teacher what it holds. Nothing
 * of a row reaches the teacher that the teacher isn't shown already: a value only one row has
 * comes from a row in `shown`, which no set of tasks is made from, and a value that several rows
 * share names no row, so a column with a few values (a status, a region) lists those it has in
 * common, which a filter needs. Any other column gives the values of the rows in `shown`.
 */
export function examplesOf(table: Table, column: string, shown: ReadonlySet<number>): string[] {
  const values = new Map<string, { first: string; row: number; count: number }>();
  for (const [at, row] of table.rows.entries()) {
    const text = cleanText(row[column]);
    if (text === '') continue;
    const key = text.toLowerCase();
    const seen = values.get(key);
    if (seen) seen.count += 1;
    else values.set(key, { first: text, row: at, count: 1 });
  }
  let chosen: string[];
  if (values.size <= FEW_VALUES) {
    chosen = [...values.values()]
      .filter((value) => value.count > 1 || shown.has(value.row))
      .sort((a, b) => b.count - a.count)
      .map((value) => value.first);
  } else {
    const fromShown = new Set<string>();
    for (const at of [...shown].sort((a, b) => a - b)) {
      const text = cleanText(table.rows[at]?.[column]);
      if (text !== '') fromShown.add(text);
    }
    chosen = [...fromShown];
  }
  return chosen.slice(0, EXAMPLES).map(shortened);
}

/** A number read from a cell that has to hold one: blank, a number, or a word that isn't one. */
export type NumberCell = { empty: true } | { empty: false; value: Decimal } | { bad: string };

export function numberCell(cell: string | null): NumberCell {
  if (isBlank(cell)) return { empty: true };
  const value = parseDecimal(cell);
  return value === null ? { bad: cleanText(cell) } : { empty: false, value };
}

/** A day read from a cell that has to hold one. */
export type DayCell = { empty: true } | { empty: false; day: string } | { bad: string };

export function dayCell(cell: string | null, order: DateOrder): DayCell {
  if (isBlank(cell)) return { empty: true };
  const day = parseDay(cell, order);
  return day === null ? { bad: cleanText(cell) } : { empty: false, day };
}

export interface ResolvedDateOrder {
  order: DateOrder;
  /** True when the file doesn't settle it and month first was taken. */
  assumed: boolean;
  /** Set when the file contradicts what was asked for or contradicts itself. */
  problem?: string;
}

/**
 * How the day and month of numbers like `03/04/2026` read in a column. What was asked for wins
 * when the cells allow it; otherwise the cells decide when a day over 12 settles it; otherwise
 * month first is taken and said so.
 */
export function resolveDateOrder(
  cells: readonly (string | null)[],
  column: string,
  asked: DateOrder | undefined,
): ResolvedDateOrder {
  const seen = dateOrderEvidence(cells);
  if (seen.dayFirst && seen.monthFirst) {
    return {
      order: asked ?? 'month_first',
      assumed: false,
      problem: `${column} writes some dates day first and some month first, so Architect can't read it.`,
    };
  }
  if (seen.dayFirst) {
    return asked === 'month_first'
      ? {
          order: 'month_first',
          assumed: false,
          problem: `${column} has dates with a day over 12 first, such as 24/11/2026, so it can't be month first.`,
        }
      : { order: 'day_first', assumed: false };
  }
  if (seen.monthFirst) {
    return asked === 'day_first'
      ? {
          order: 'day_first',
          assumed: false,
          problem: `${column} has dates with a day over 12 second, such as 11/24/2026, so it can't be day first.`,
        }
      : { order: 'month_first', assumed: false };
  }
  if (asked) return { order: asked, assumed: false };
  return { order: 'month_first', assumed: seen.ambiguous > 0 };
}
