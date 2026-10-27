/**
 * The runner's read tools as the agent meets them, for reference solutions that must show a task
 * fits the agent's turns and context. read_table keeps the rows that match every where condition,
 * returns the chosen columns, gives 50 rows unless asked for up to 200, pages with offset, and
 * cuts its result to 8,000 characters; read_text hands a long file over in parts. Every call and
 * every character of every result is counted. The runner's own implementation is in
 * packages/engine (tools/results.ts and data/query.ts); this one follows it rule for rule.
 */
import { parseCsv } from '../lib/csv';

export const DEFAULT_ROWS = 50;
export const MAX_ROWS = 200;
export const RESULT_CHARACTERS = 8000;

export type Cell = string | null;
export type Row = Readonly<Record<string, Cell>>;

export interface Table {
  columns: readonly string[];
  rows: readonly Row[];
}

export interface Condition {
  column: string;
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in';
  value: string | number | readonly (string | number)[];
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

export interface TextPart {
  text: string;
  /** Where the next part starts, or null when this part ends the file. */
  nextOffset: number | null;
}

/** A job's data files as the tools serve them: tables by file name, and text files. */
export interface JobData {
  tables: ReadonlyMap<string, Table>;
  texts: ReadonlyMap<string, string>;
}

/** Parses data files given by name (`customers.csv`, `policy.md`) to their text. */
export function parseJobData(files: ReadonlyMap<string, string>): JobData {
  const tables = new Map<string, Table>();
  const texts = new Map<string, string>();
  for (const [name, text] of files) {
    if (name.endsWith('.csv')) {
      tables.set(name, {
        columns: text.slice(0, text.indexOf('\n')).split(','),
        rows: parseCsv(text),
      });
    } else {
      texts.set(name, text);
    }
  }
  return { tables, texts };
}

/** One agent's use of the read tools: each new instance starts counting from zero. */
export class ReadTools {
  private callCount = 0;
  private characterCount = 0;
  private readonly tables: ReadonlyMap<string, Table>;
  private readonly texts: ReadonlyMap<string, string>;

  constructor(data: JobData) {
    this.tables = data.tables;
    this.texts = data.texts;
  }

  /** Tool calls made so far. */
  get calls(): number {
    return this.callCount;
  }

  /** Characters of tool results read so far, the way the agent's conversation holds them. */
  get characters(): number {
    return this.characterCount;
  }

  readTable(read: TableRead): TablePage {
    const table = this.tables.get(read.file);
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
    const rowSizes = prefixSums(cells.map((row) => JSON.stringify(row).length));
    const size = (count: number) => {
      const end = offset + count;
      const frame: Record<string, unknown> = {
        file: read.file,
        columns,
        rows: [],
        total: matching.length,
        truncated: end < matching.length,
      };
      if (end < matching.length) {
        frame.note = pageNote(offset, count, matching.length, count < page.length);
      }
      const rows = count === 0 ? 0 : (rowSizes[count] as number) + count - 1;
      return JSON.stringify(frame).length + rows;
    };
    const count = largestCount(page.length, (n) => size(n) <= RESULT_CHARACTERS);

    this.callCount += 1;
    this.characterCount += size(count);
    return {
      rows: page.slice(0, count),
      total: matching.length,
      truncated: offset + count < matching.length,
    };
  }

  readText(file: string, offset = 0): TextPart {
    const text = this.texts.get(file);
    if (text === undefined) throw new Error(`No text file ${file}`);
    this.callCount += 1;
    const whole = JSON.stringify({ file, text: text.slice(offset) }).length;
    if (whole <= RESULT_CHARACTERS) {
      this.characterCount += whole;
      return { text: text.slice(offset), nextOffset: null };
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
    this.characterCount += part(length);
    return { text: text.slice(offset, offset + length), nextOffset: offset + length };
  }
}

/** One where condition as a row test, compared the way the runner compares cells. */
function compile(condition: Condition): (row: Row) => boolean {
  const { column, op, value } = condition;
  const cellOf = (row: Row) => row[column] ?? null;
  if (op === 'in') {
    if (!Array.isArray(value)) throw new Error(`in needs a list (column ${column})`);
    const options = (value as readonly (string | number)[]).map(asText);
    const texts = new Set(options.filter((option) => parseNumber(option) === null));
    const numbers = new Set(options.map(parseNumber).filter((number) => number !== null));
    return (row) => {
      const cell = cellOf(row);
      if (cell === null) return false;
      const number = parseNumber(cell);
      return number === null ? texts.has(cell) : numbers.has(number);
    };
  }
  if (Array.isArray(value)) throw new Error(`Only in takes a list (column ${column})`);
  const expected = asText(value as string | number);
  return (row) => {
    const order = compareCells(cellOf(row), expected);
    switch (op) {
      case '=':
        return order === 0;
      case '!=':
        return order !== 0;
      case '>':
        return order !== null && order > 0;
      case '>=':
        return order !== null && order >= 0;
      case '<':
        return order !== null && order < 0;
      case '<=':
        return order !== null && order <= 0;
    }
  };
}

/** Sign of cell minus expected: as numbers when both read as numbers, else by code unit. */
function compareCells(cell: Cell, expected: string): number | null {
  if (cell === null) return null;
  const a = parseNumber(cell);
  const b = parseNumber(expected);
  if (a !== null && b !== null) return Math.sign(a - b);
  return cell < expected ? -1 : cell > expected ? 1 : 0;
}

function asText(value: string | number): string {
  return String(value);
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

/** sums[i] is the total of the first i sizes. */
function prefixSums(sizes: readonly number[]): number[] {
  const sums = [0];
  for (const size of sizes) sums.push((sums.at(-1) as number) + size);
  return sums;
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
