/**
 * The agent's built-in tools as the runner serves them, for reference solutions that must show a
 * task fits the agent's turns and context. read gives a file's lines numbered, as many as fit
 * 8,000 characters, and says where to read on; run gives back "=> " and the JSON of its code's
 * last value, which must fit 8,000 characters too; append adds rows to a table. Each call keeps
 * what the agent would send, the code for run included, and the text it gets back, and every
 * character of that text counts. The runner's own tools are in packages/engine (tools/format.ts
 * and tools/builtins.ts); the tests replay every call through them and compare the text.
 */
import type { JsonValue } from '@architect/shared';
import { csvColumns, parseCsv, toCsv } from '../lib/csv';
import type { CsvRow } from '../lib/csv';

/** Characters a tool result may take. */
export const RESULT_CHARACTERS = 8000;
const READ_LINES = 200;
/** Room a read keeps for the line that says how to read on. */
const NOTE_ROOM = 120;

/** A row the way csv.parse hands it to the agent's code: every value text, "" when empty. */
export type CodeRow = Readonly<Record<string, string>>;

/** A value of a row the code fetched. A column the row lacks is a mistake in the reference. */
export function cell(row: CodeRow, column: string): string {
  const value = row[column];
  if (value === undefined) throw new Error(`A row has no column ${column}`);
  return value;
}

export interface ToolCall {
  name: 'read' | 'run' | 'append';
  arguments: Record<string, JsonValue>;
  /** The text the agent gets back. */
  content: string;
}

interface Table {
  columns: string[];
  rows: CsvRow[];
  code: CodeRow[];
}

/** A job's data files by name (`orders.csv`, `policy.md`), each table parsed once. */
export class JobFiles {
  private readonly tables = new Map<string, Table>();

  constructor(private readonly texts: ReadonlyMap<string, string>) {}

  text(name: string): string {
    const text = this.texts.get(name);
    if (text === undefined) throw new Error(`No file ${name}`);
    return text;
  }

  /** A table's columns, in order. */
  columns(name: string): string[] {
    return this.table(name).columns;
  }

  /** A table's rows as an export wrote them, empty cells null. */
  rows(name: string): readonly CsvRow[] {
    return this.table(name).rows;
  }

  /** The same rows the way the agent's code sees them. */
  codeRows(name: string): readonly CodeRow[] {
    return this.table(name).code;
  }

  private table(name: string): Table {
    let table = this.tables.get(name);
    if (!table) {
      const text = this.text(name);
      const rows = parseCsv(text);
      const code = rows.map((row) =>
        Object.fromEntries(Object.entries(row).map(([column, cell]) => [column, cell ?? ''])),
      );
      table = { columns: csvColumns(text), rows, code };
      this.tables.set(name, table);
    }
    return table;
  }
}

/** What a run's code reads, as the reference works it out: rows of a table, noted as seen. */
export interface Tables {
  /** The rows of a table that pass the test, in file order. */
  where(name: string, test: (row: CodeRow) => boolean): CodeRow[];
  /** The one row that passes the test; any other count is a mistake in the reference. */
  one(name: string, test: (row: CodeRow) => boolean): CodeRow;
}

/** One agent attempt's tool calls. Each new instance starts from nothing. */
export class AgentTools {
  readonly calls: ToolCall[] = [];
  private readonly appended = new Map<string, CsvRow[]>();
  private readonly seen = new Map<string, Set<number>>();

  constructor(private readonly files: JobFiles) {}

  /** Characters of tool results so far, the way the agent's conversation holds them. */
  get characters(): number {
    return this.calls.reduce((total, call) => total + call.content.length, 0);
  }

  /** Rows appended to a table during this attempt. */
  appendedTo(name: string): readonly CsvRow[] {
    return this.appended.get(name) ?? [];
  }

  /** Positions in a table's file of the rows the code of this attempt read. */
  rowsSeen(name: string): ReadonlySet<number> {
    return this.seen.get(name) ?? new Set();
  }

  /** Reads a whole file, in as many reads as it takes. */
  readAll(name: string): void {
    const lines = this.files.text(name).replace(/\n$/, '').split('\n');
    for (let offset = 1; offset <= lines.length;) offset = this.read(name, lines, offset);
  }

  /**
   * Runs code and returns its last value as the agent reads it back. `compute` works the value
   * out the way the code does, from the same rows; the tests run the code itself through the
   * runner and compare. A result too long for the agent to see whole is a mistake here.
   */
  run<T extends JsonValue>(code: string, compute: (tables: Tables) => T): T {
    const where = (name: string, test: (row: CodeRow) => boolean) => this.select(name, test);
    const value = compute({
      where,
      one: (name, test) => {
        const rows = where(name, test);
        if (rows.length !== 1 || !rows[0]) throw new Error(`${rows.length} rows of ${name} match`);
        return rows[0];
      },
    });
    const json = JSON.stringify(value);
    const content = `=> ${json}`;
    if (content.length > RESULT_CHARACTERS) {
      throw new Error(`A result of ${content.length} characters would reach the agent cut`);
    }
    this.calls.push({ name: 'run', arguments: { code }, content });
    return JSON.parse(json) as T;
  }

  /** Appends rows to a table, written as CSV in its column order. */
  append(name: string, rows: readonly CsvRow[]): void {
    const columns = this.files.columns(name);
    const csv = toCsv(
      columns,
      rows.map((row) => columns.map((column) => row[column] ?? null)),
    );
    this.appended.set(name, [...this.appendedTo(name), ...rows]);
    this.calls.push({
      name: 'append',
      arguments: { path: `data/${name}`, text: csv.slice(csv.indexOf('\n') + 1) },
      content: `Added ${plural(rows.length, 'row')} to data/${name}.`,
    });
  }

  /** One read, its lines numbered the way the runner numbers them; returns where the next starts. */
  private read(name: string, lines: readonly string[], offset: number): number {
    const last = Math.min(lines.length, offset + READ_LINES - 1);
    const width = String(last).length;
    const room = RESULT_CHARACTERS - NOTE_ROOM;
    const shown: string[] = [];
    let size = 0;
    for (let number = offset; number <= last; number += 1) {
      const line = `${String(number).padStart(width)}\t${lines[number - 1] ?? ''}`;
      if (line.length > room)
        throw new Error(`Line ${number} of ${name} is too long to read whole`);
      if (shown.length > 0 && size + line.length + 1 > room) break;
      shown.push(line);
      size += line.length + 1;
    }
    const to = offset + shown.length - 1;
    const note =
      to < lines.length
        ? `\n[Lines ${offset}-${to} of ${lines.length}. ${plural(lines.length - to, 'more line')}: read on with offset ${to + 1}.]`
        : '';
    this.calls.push({
      name: 'read',
      arguments: offset === 1 ? { path: `data/${name}` } : { path: `data/${name}`, offset },
      content: `${shown.join('\n')}${note}`,
    });
    return to + 1;
  }

  private select(name: string, test: (row: CodeRow) => boolean): CodeRow[] {
    const seen = this.seen.get(name) ?? new Set<number>();
    this.seen.set(name, seen);
    const matching: CodeRow[] = [];
    this.files.codeRows(name).forEach((row, index) => {
      if (!test(row)) return;
      seen.add(index);
      matching.push(row);
    });
    return matching;
  }
}

/** "1 row", "1,038 more lines": a count the way the runner writes it. */
function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}
