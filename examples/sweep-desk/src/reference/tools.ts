/**
 * The agent's built-in tools as the runner serves them, for reference solutions that must show a
 * task fits the agent's turns and context. read gives a file's lines numbered, as many as fit
 * 8,000 characters, and says where to read on; run gives back "=> " and the JSON of its code's
 * last value, which must fit 8,000 characters too; append adds rows to a table. Each call keeps
 * what the agent would send and the text it gets back, and every character of that text counts.
 *
 * Here `run` runs the code in a fresh node context with the same `files.read` and `csv.parse` the
 * runner's sandbox gives it. The runner's own tools are in packages/engine (tools/builtins.ts and
 * the sandbox prelude); the tests replay every call through them and compare the text.
 */
import vm from 'node:vm';
import type { JsonValue } from '@architect/shared';
import { csvColumns, parseCsv, toCsv } from '../lib/csv';
import type { CsvRow } from '../lib/csv';

/** Characters a tool result may take. */
export const RESULT_CHARACTERS = 8000;
const READ_LINES = 200;
/** Room a read keeps for the line that says how to read on. */
const NOTE_ROOM = 120;

export interface ToolCall {
  name: 'read' | 'run' | 'append';
  arguments: Record<string, JsonValue>;
  /** The text the agent gets back. */
  content: string;
}

/** One agent attempt's tool calls on a group's files. Each new instance starts from nothing. */
export class AgentTools {
  readonly calls: ToolCall[] = [];
  private readonly appended = new Map<string, CsvRow[]>();

  constructor(private readonly files: ReadonlyMap<string, string>) {}

  private text(name: string): string {
    const text = this.files.get(name);
    if (text === undefined) throw new Error(`No file ${name}`);
    return text;
  }

  /** The whole text of a file this attempt has read. */
  fileText(name: string): string {
    const path = `data/${name}`;
    if (!this.calls.some((call) => call.name === 'read' && call.arguments.path === path)) {
      throw new Error(`${name} was not read in this attempt`);
    }
    return this.text(name);
  }

  /** Characters of tool results so far, the way the agent's conversation holds them. */
  get characters(): number {
    return this.calls.reduce((total, call) => total + call.content.length, 0);
  }

  /** Rows appended to a table during this attempt. */
  appendedTo(name: string): readonly CsvRow[] {
    return this.appended.get(name) ?? [];
  }

  /** Reads a whole file, in as many reads as it takes. */
  readAll(name: string): void {
    const lines = this.text(name).replace(/\n$/, '').split('\n');
    for (let offset = 1; offset <= lines.length;) offset = this.read(name, lines, offset);
  }

  /** Runs code and returns its last value as the agent reads it back. */
  run(code: string): JsonValue {
    const files = {
      read: (path: string) => {
        const name = path.replace(/^data\//, '');
        return this.text(name);
      },
    };
    const csv = {
      parse: (text: string) =>
        parseCsv(text).map((row) =>
          Object.fromEntries(Object.entries(row).map(([column, cell]) => [column, cell ?? ''])),
        ),
    };
    const value: unknown = vm.runInNewContext(code, { files, csv });
    const json = JSON.stringify(value);
    const content = `=> ${json}`;
    if (content.length > RESULT_CHARACTERS) {
      throw new Error(`A result of ${content.length} characters would reach the agent cut`);
    }
    this.calls.push({ name: 'run', arguments: { code }, content });
    return JSON.parse(json) as JsonValue;
  }

  /** Appends rows to a table, written as CSV in its column order. */
  append(name: string, rows: readonly CsvRow[]): void {
    const columns = csvColumns(this.text(name));
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
}

/** "1 row", "1,038 more lines": a count the way the runner writes it. */
function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}
