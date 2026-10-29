import type { RuleSpec } from '@architect/shared';
import type { Row } from '../../data/types';
import type { Table } from '../table';
import { cleanText, foldKey, isBlank, parseDecimal } from '../values';
import { currencyName, fits, marksIn } from './currency';
import {
  categoryRefs,
  evaluate,
  numberRefs,
  refKey,
  type CaseInputs,
  type ColumnRef,
  type Run,
} from './expression';
import * as q from './rational';

/*
 * The cases of a rule: one for each row of its table, with the values the expression needs read
 * from the row and from the row looked up in another table. A case whose inputs can't all be read
 * is left out and counted with its reason; nothing is ever read as zero or guessed.
 */

/** The largest answer a case may have; a larger one is a mistake in the records. */
const LARGEST = q.fraction(1_000_000_000n);

export interface RuleCase {
  /** The row's key, as the file spells it. */
  key: string;
  /** The entity the case belongs to, lowercased, for keeping related cases in one set. */
  family: string;
  row: Row;
  lookupRow: Row | null;
  inputs: CaseInputs;
  /** The cells the numbers were read from, by column, for showing the working. */
  cells: Map<string, string>;
  numbers: Map<string, q.Q>;
  categories: Map<string, string>;
  run: Run;
  answer: q.Q;
}

export interface Exclusion {
  reason: string;
  count: number;
  example: string;
}

export interface Cases {
  cases: RuleCase[];
  excluded: Exclusion[];
}

export interface Tables {
  source: Table;
  lookup: Table | null;
}

/** The cases' inputs as an expression reads them. */
export function inputsOf(
  numbers: ReadonlyMap<string, q.Q>,
  categories: ReadonlyMap<string, string>,
): CaseInputs {
  return {
    number: (ref) => numbers.get(refKey(ref)) ?? q.ZERO,
    category: (ref) => categories.get(refKey(ref)) ?? '',
  };
}

function cellOf(ref: ColumnRef, row: Row, lookupRow: Row | null): string | null {
  const from = ref.from === 'row' ? row : lookupRow;
  return from?.[ref.column] ?? null;
}

/** Why a case cannot be made, with the text that shows it. */
class Skip extends Error {
  constructor(
    readonly reason: string,
    readonly shown: string,
  ) {
    super(reason);
  }
}

export function makeCases(spec: RuleSpec, tables: Tables): Cases {
  const { source, lookup } = tables;
  const numberColumns = numberRefs(spec.expression);
  const categoryColumns = categoryRefs(spec.expression);
  const declared = new Map(
    spec.categories.map((category) => [
      refKey(category),
      new Set(category.values.map((value) => foldKey(value))),
    ]),
  );
  const where = (ref: ColumnRef): string =>
    ref.from === 'lookup' && spec.lookup ? `${ref.column} (${spec.lookup.table})` : ref.column;

  const keyCounts = new Map<string, number>();
  for (const row of source.rows) {
    const key = foldKey(row[spec.keyColumn]);
    if (key !== '') keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const index = new Map<string, Row[]>();
  if (lookup && spec.lookup) {
    for (const row of lookup.rows) {
      const key = foldKey(row[spec.lookup.keyColumn]);
      if (key !== '') index.set(key, [...(index.get(key) ?? []), row]);
    }
  }

  const cases: RuleCase[] = [];
  const skipped = new Map<string, Exclusion>();
  const skip = (reason: string, shown: string): void => {
    const seen = skipped.get(reason);
    if (seen) seen.count += 1;
    else skipped.set(reason, { reason, count: 1, example: shown });
  };

  for (const row of source.rows) {
    const key = cleanText(row[spec.keyColumn]);
    try {
      if (key === '') throw new Skip(`${spec.keyColumn} is empty`, 'a row with no key');
      if ((keyCounts.get(key.toLowerCase()) ?? 0) > 1) {
        throw new Skip(`${spec.keyColumn} is used by more than one row`, key);
      }
      let lookupRow: Row | null = null;
      if (spec.lookup && lookup) {
        const match = foldKey(row[spec.lookup.matchColumn]);
        if (match === '') {
          throw new Skip(
            `${spec.lookup.matchColumn} is empty, so there is nothing to look up`,
            key,
          );
        }
        const found = index.get(match) ?? [];
        if (found.length === 0) {
          throw new Skip(
            `${spec.lookup.matchColumn} has no row in ${spec.lookup.table}`,
            `${cleanText(row[spec.lookup.matchColumn])} in ${key}`,
          );
        }
        if (found.length > 1) {
          throw new Skip(
            `${spec.lookup.table} lists the same ${spec.lookup.keyColumn} more than once`,
            `${cleanText(row[spec.lookup.matchColumn])} in ${key}`,
          );
        }
        lookupRow = found[0] ?? null;
      }
      const numbers = new Map<string, q.Q>();
      const categories = new Map<string, string>();
      const cells = new Map<string, string>();
      for (const ref of numberColumns) {
        const cell = cellOf(ref, row, lookupRow);
        if (isBlank(cell)) throw new Skip(`${where(ref)} is empty or N/A`, key);
        const value = parseDecimal(cell);
        if (value === null) {
          throw new Skip(`${where(ref)} can't be read as a number`, `${cleanText(cell)} in ${key}`);
        }
        if (
          marksIn(cell).length > 0 &&
          (spec.currency === undefined || !fits(cell, spec.currency))
        ) {
          throw new Skip(
            spec.currency === undefined
              ? `${where(ref)} has a currency sign, but the rule names no currency`
              : `${where(ref)} is written in a currency other than ${currencyName(spec.currency)}`,
            `${cleanText(cell)} in ${key}`,
          );
        }
        numbers.set(refKey(ref), q.fromDecimal(value));
        cells.set(refKey(ref), cleanText(cell));
      }
      for (const ref of categoryColumns) {
        const cell = cellOf(ref, row, lookupRow);
        const value = foldKey(cell);
        if (value === '') throw new Skip(`${where(ref)} is empty`, key);
        if (!declared.get(refKey(ref))?.has(value)) {
          throw new Skip(
            `${where(ref)} has a value the rule does not list`,
            `${cleanText(cell)} in ${key}`,
          );
        }
        categories.set(refKey(ref), value);
        cells.set(refKey(ref), cleanText(cell));
      }
      const inputs = inputsOf(numbers, categories);
      const run = evaluate(spec.expression, inputs);
      if (q.isNegative(run.value)) throw new Skip('the answer comes out below zero', key);
      if (q.compare(run.value, LARGEST) > 0) {
        throw new Skip('the answer comes out above 1,000,000,000', key);
      }
      const familyCell = spec.familyColumn === undefined ? key : cleanText(row[spec.familyColumn]);
      if (familyCell === '') throw new Skip(`${spec.familyColumn ?? ''} is empty`, key);
      cases.push({
        key,
        family: familyCell.toLowerCase(),
        row,
        lookupRow,
        inputs,
        cells,
        numbers,
        categories,
        run,
        answer: run.value,
      });
    } catch (error) {
      if (!(error instanceof Skip)) throw error;
      skip(error.reason, error.shown);
    }
  }
  return {
    cases,
    excluded: [...skipped.values()].sort((a, b) => b.count - a.count),
  };
}
