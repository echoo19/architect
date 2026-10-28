/**
 * The runner's built-in tools as the agent meets them, for reference solutions that must show a
 * task fits the agent's turns and context. read_table keeps the rows that match every where
 * condition (=, !=, <, <=, >, >=, contains and in), returns the chosen columns, gives 50 rows
 * unless asked for up to 200, pages with offset, and cuts its result to 8,000 characters;
 * read_text hands a long file over in parts; calculate and append_rows are calls like any other.
 * Every call and every character of every result is counted. The runner's own implementation is
 * in packages/engine (data/query.ts, tools/results.ts and tools/builtins.ts); this one follows it
 * rule for rule, and the tests compare the two on this job's files.
 */
import { csvColumns, parseCsv } from '../lib/csv';

const DEFAULT_ROWS = 50;
export const MAX_ROWS = 200;
const RESULT_CHARACTERS = 8000;

export type Cell = string | null;
export type Row = Readonly<Record<string, Cell>>;

export interface Table {
  columns: readonly string[];
  rows: readonly Row[];
}

export type Operator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'in';

export interface Condition {
  column: string;
  op: Operator;
  value: string | number | null | readonly (string | number)[];
}

export interface TableRead {
  file: string;
  where?: readonly Condition[];
  columns?: readonly string[];
  limit?: number;
  offset?: number;
}

export interface TablePage {
  rows: Row[];
  /** Rows matching the conditions, before offset and limit. */
  total: number;
  /** True when more matching rows come after the returned ones. */
  truncated: boolean;
}

/** A job's data files as the tools serve them: tables by file name, and text files. */
export interface JobData {
  tables: ReadonlyMap<string, Table>;
  texts: ReadonlyMap<string, string>;
}

/** Parses data files given by name (`orders.csv`, `policy.md`) to their text. */
export function parseJobData(files: ReadonlyMap<string, string>): JobData {
  const tables = new Map<string, Table>();
  const texts = new Map<string, string>();
  for (const [name, text] of files) {
    if (name.endsWith('.csv'))
      tables.set(name, { columns: csvColumns(text), rows: parseCsv(text) });
    else texts.set(name, text);
  }
  return { tables, texts };
}

/** One agent's use of the tools: each new instance starts counting from zero. */
export class DeskTools {
  private callCount = 0;
  private characterCount = 0;
  private readonly appended = new Map<string, Row[]>();
  private readonly seen = new Map<string, Set<number>>();

  constructor(private readonly data: JobData) {}

  /** Tool calls made so far. */
  get calls(): number {
    return this.callCount;
  }

  /** Characters of tool results so far, the way the agent's conversation holds them. */
  get characters(): number {
    return this.characterCount;
  }

  /** Rows appended to a table during this attempt. */
  appendedTo(file: string): readonly Row[] {
    return this.appended.get(file) ?? [];
  }

  /** Positions in a table's file of the rows its reads have returned so far. */
  rowsSeen(file: string): ReadonlySet<number> {
    return this.seen.get(file) ?? new Set();
  }

  readTable(read: TableRead): TablePage {
    const table = this.data.tables.get(read.file);
    if (!table) throw new Error(`No table ${read.file}`);
    const columns = read.columns ?? table.columns;
    const named = [...(read.where ?? []).map((condition) => condition.column), ...columns];
    const unknown = named.find((column) => !table.columns.includes(column));
    if (unknown !== undefined) throw new Error(`${read.file} has no column ${unknown}`);
    const tests = (read.where ?? []).map(compile);
    const matching = table.rows.filter((row) => tests.every((test) => test(row)));
    const offset = read.offset ?? 0;
    const limit = Math.min(read.limit ?? DEFAULT_ROWS, MAX_ROWS);
    const page = matching.slice(offset, offset + limit);
    const cells = page.map((row) => columns.map((column) => row[column] ?? null));

    const result = (count: number) => {
      const end = offset + count;
      const value: Record<string, unknown> = {
        file: read.file,
        columns,
        rows: cells.slice(0, count),
        total: matching.length,
        truncated: end < matching.length,
      };
      if (end < matching.length) {
        value.note = pageNote(offset, count, matching.length, count < page.length);
      }
      return JSON.stringify(value).length;
    };
    const count = largestCount(page.length, (n) => result(n) <= RESULT_CHARACTERS);
    this.count(result(count));
    const seen = this.seen.get(read.file) ?? new Set<number>();
    for (const row of page.slice(0, count)) seen.add(table.rows.indexOf(row));
    this.seen.set(read.file, seen);
    return {
      rows: cells
        .slice(0, count)
        .map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i] ?? null]))),
      total: matching.length,
      truncated: offset + count < matching.length,
    };
  }

  /** The whole text file, read in as many parts as it takes. */
  readText(file: string): string {
    const text = this.data.texts.get(file);
    if (text === undefined) throw new Error(`No text file ${file}`);
    let offset = 0;
    for (;;) {
      const whole = JSON.stringify({ file, text: text.slice(offset) }).length;
      if (whole <= RESULT_CHARACTERS) {
        this.count(whole);
        return text;
      }
      const part = (length: number) =>
        JSON.stringify({
          file,
          text: text.slice(offset, offset + length),
          total_chars: text.length,
          next_offset: offset + length,
          note: `This is part of ${file}. Call read_text again with offset ${offset + length} for the rest.`,
        }).length;
      const fits = largestCount(text.length - offset, (n) => part(n) <= RESULT_CHARACTERS);
      const throughLineBreak = text.lastIndexOf('\n', offset + fits - 1) + 1 - offset;
      const length = throughLineBreak > fits / 2 ? throughLineBreak : fits;
      this.count(part(length));
      offset += length;
    }
  }

  /**
   * One calculate call. The reference solutions work out `value` themselves; the call is what an
   * agent spends to get it, written out as the expression it would send.
   */
  calculate(expression: string, value: number): number {
    if (expression.trim() === '') throw new Error('An empty expression');
    this.count(JSON.stringify({ result: value }).length);
    return value;
  }

  appendRows(file: string, rows: readonly Row[]): void {
    if (!this.data.tables.has(file)) throw new Error(`No table ${file}`);
    this.appended.set(file, [...this.appendedTo(file), ...rows]);
    this.count(JSON.stringify({ file, appended: rows.length }).length);
  }

  private count(characters: number): void {
    this.callCount += 1;
    this.characterCount += characters;
  }
}

/** One where condition as a row test, compared the way the runner compares cells. */
function compile(condition: Condition): (row: Row) => boolean {
  const { column, op, value } = condition;
  const cellOf = (row: Row): Cell => row[column] ?? null;
  if (op === 'in') {
    if (!Array.isArray(value)) throw new Error(`in needs a list (column ${column})`);
    const options = (value as readonly (string | number)[]).map(asText);
    return (row) => options.some((option) => equals(cellOf(row), option));
  }
  if (Array.isArray(value)) throw new Error(`Only in takes a list (column ${column})`);
  const expected = asText(value as string | number | null);
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
    default:
      return (row) => {
        const order = compareCells(cellOf(row), expected);
        if (order === null) return false;
        if (op === '>') return order > 0;
        if (op === '>=') return order >= 0;
        if (op === '<') return order < 0;
        return order <= 0;
      };
  }
}

/** A value as cell text. An empty string means an empty cell, as it does on load. */
function asText(value: string | number | null): string | null {
  if (value === null || value === '') return null;
  return String(value);
}

function equals(cell: Cell, expected: string | null): boolean {
  if (cell === null || expected === null) return cell === expected;
  const a = parseNumber(cell);
  const b = parseNumber(expected);
  return a !== null && b !== null ? a === b : cell === expected;
}

/** Sign of cell minus expected: as numbers when both read as numbers, else by code unit. */
function compareCells(cell: Cell, expected: string | null): number | null {
  if (cell === null || expected === null) return null;
  const a = parseNumber(cell);
  const b = parseNumber(expected);
  if (a !== null && b !== null) return Math.sign(a - b);
  return cell < expected ? -1 : cell > expected ? 1 : 0;
}

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function pageNote(offset: number, count: number, total: number, cutForSize: boolean): string {
  const end = offset + count;
  const shown =
    count > 0
      ? `Rows ${offset + 1} to ${end} of ${total} are shown`
      : `${total} rows match and none are shown`;
  const reason = cutForSize ? ' to stay within the size limit' : '';
  const fewer = cutForSize ? ', or ask for fewer columns' : '';
  return `${shown}${reason}. Read again with offset ${end} for more${fewer}.`;
}

/** The largest count from 0 to max that fits, by binary search (fit shrinks as count grows). */
function largestCount(max: number, fits: (count: number) => boolean): number {
  if (fits(max)) return max;
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}
