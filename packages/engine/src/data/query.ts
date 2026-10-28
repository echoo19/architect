import type { WhereClause } from '@architect/shared';
import { DataError } from './errors';
import { parseNumber } from './numbers';
import type { Row, TableSnapshot } from './types';

/** Which rows and columns to take from a table. Every condition in `where` must hold. */
export interface RowSelection {
  where?: readonly WhereClause[];
  columns?: readonly string[];
}

type Scalar = string | number | boolean | null;
type OrderOp = '>' | '>=' | '<' | '<=';

const ORDER_TESTS: Record<OrderOp, (order: number) => boolean> = {
  '>': (order) => order > 0,
  '>=': (order) => order >= 0,
  '<': (order) => order < 0,
  '<=': (order) => order <= 0,
};

/**
 * The rows that match every condition, with only the requested columns. Comparisons are
 * numeric when both sides read as plain numbers and by text otherwise; `contains` ignores case.
 * An unknown column throws, so a typo can't silently match nothing.
 */
export function selectRows(
  file: string,
  table: TableSnapshot,
  selection: RowSelection,
): { columns: string[]; rows: Row[] } {
  const where = selection.where ?? [];
  assertColumns(
    file,
    table,
    where.map((clause) => clause.column),
  );
  const matching = table.rows.filter(rowMatcher(where));
  if (!selection.columns) return { columns: [...table.columns], rows: matching };

  const columns = [...new Set(selection.columns)];
  assertColumns(file, table, columns);
  return { columns, rows: matching.map((row) => pick(row, columns)) };
}

function assertColumns(file: string, table: TableSnapshot, names: readonly string[]): void {
  const unknown = names.find((name) => !table.columns.includes(name));
  if (unknown !== undefined) {
    throw new DataError(
      `${file} has no column "${unknown}". Its columns are: ${table.columns.join(', ')}.`,
    );
  }
}

/** A test that a row meets every condition. */
function rowMatcher(where: readonly WhereClause[]): (row: Row) => boolean {
  const tests = where.map(compileClause);
  return (row) => tests.every((test) => test(row));
}

function compileClause(clause: WhereClause): (row: Row) => boolean {
  const { column, op, value } = clause;
  const cellOf = (row: Row): string | null => row[column] ?? null;

  if (op === 'in') {
    if (!Array.isArray(value)) {
      throw new DataError(
        `The in operator needs a list of values, like ["A", "B"] (column ${column}).`,
      );
    }
    const options = value.map(asText);
    return (row) => options.some((option) => equals(cellOf(row), option));
  }
  if (Array.isArray(value)) {
    throw new DataError(
      `Only the in operator takes a list; ${op} on column ${column} needs one value.`,
    );
  }

  const expected = asText(value);
  switch (op) {
    case '=':
      return (row) => equals(cellOf(row), expected);
    case '!=':
      return (row) => !equals(cellOf(row), expected);
    case 'contains': {
      const needle = expected?.toLowerCase();
      return (row) => {
        const cell = cellOf(row);
        return needle !== undefined && cell !== null && cell.toLowerCase().includes(needle);
      };
    }
    default: {
      const test = ORDER_TESTS[op];
      return (row) => {
        const order = compare(cellOf(row), expected);
        return order !== null && test(order);
      };
    }
  }
}

/** A comparison value as cell text. An empty string means an empty cell, as it does on load. */
function asText(value: Scalar): string | null {
  if (value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function equals(cell: string | null, expected: string | null): boolean {
  if (cell === null || expected === null) return cell === expected;
  const a = parseNumber(cell);
  const b = parseNumber(expected);
  return a !== null && b !== null ? a === b : cell === expected;
}

/** Sign of cell minus expected, or null when either side is empty. */
function compare(cell: string | null, expected: string | null): number | null {
  if (cell === null || expected === null) return null;
  const a = parseNumber(cell);
  const b = parseNumber(expected);
  if (a !== null && b !== null) return Math.sign(a - b);
  // Code-unit order, not localeCompare: the same on every machine.
  return cell < expected ? -1 : cell > expected ? 1 : 0;
}

function pick(row: Row, columns: readonly string[]): Row {
  return Object.freeze(Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
}
