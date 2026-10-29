import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { DRAFTING_LIMITS, TaskSchema, type DataFile, type Task } from '@architect/shared';
import { profileColumn, readTable, type ColumnProfile, type Table } from './table';
import { cleanText } from './values';

/*
 * The files a person attaches when describing a job: tables and text the agent works from, and
 * maybe a tasks file. A table or a text file is read in full and kept here until the job is
 * drafted, so the tasks are made from the bytes the teacher was told about, whatever happens to
 * the person's copy meanwhile.
 */

/** The most files, bytes of one file and bytes in all that a job may be drafted from. */
export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

export interface Attachment {
  /** The name it has in the job: the person's file name, made safe. */
  name: string;
  kind: DataFile['kind'];
  /** Exactly what the person's file held. */
  bytes: Buffer;
  /** Tables only. */
  table?: Table;
  /** Text only: all of it. */
  text?: string;
}

/** Example tasks in Architect's format, which the teacher is told only the count and types of. */
export interface TasksFile {
  name: string;
  tasks: Task[];
  /** Each type with how many tasks it has, in the order they first appear. */
  types: { id: string; count: number }[];
}

export interface Attached {
  files: Attachment[];
  tasks: TasksFile | null;
}

const TABLE_EXTENSIONS = new Set(['.csv']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);
const TASK_EXTENSIONS = new Set(['.jsonl']);

const NOT_YET: Readonly<Record<string, string>> = {
  '.xlsx': 'a spreadsheet',
  '.xls': 'a spreadsheet',
  '.ods': 'a spreadsheet',
  '.numbers': 'a spreadsheet',
  '.pdf': 'a PDF',
  '.doc': 'a Word document',
  '.docx': 'a Word document',
  '.json': 'a JSON file',
};

/** A file name the job accepts: letters, digits, dots, dashes, underscores and spaces. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/^[^A-Za-z0-9]+/, '');
  return (cleaned === '' ? 'file' : cleaned).slice(0, 120);
}

/** Makes the name differ from the ones taken, by a number before the extension. */
function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let next = 2; ; next += 1) {
    const candidate = `${stem.slice(0, 110)}-${next}${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

/** The tasks of a tasks file, or the first thing wrong with it. */
function readTasks(name: string, text: string): TasksFile {
  const tasks: Task[] = [];
  const ids = new Set<string>();
  const lines = text.replace(/^\u{feff}/u, '').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const where = `${name}, line ${index + 1}`;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`${where} isn't JSON. A tasks file has one task per line.`);
    }
    const parsed = TaskSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join('.') ?? '';
      throw new Error(
        `${where} isn't a task Architect can read${field === '' ? '' : `: "${field}" is missing or wrong`}. A task needs an id, a type, a family, a prompt and an expected answer.`,
      );
    }
    if (parsed.data.expected.kind === 'end_state') {
      throw new Error(
        `${where} expects an end state, which needs a checker file. Tasks attached here need an answer or facts to compare with.`,
      );
    }
    if (ids.has(parsed.data.id)) throw new Error(`${where} repeats the id ${parsed.data.id}.`);
    ids.add(parsed.data.id);
    tasks.push(parsed.data);
  }
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.type, (counts.get(task.type) ?? 0) + 1);
  return { name, tasks, types: [...counts].map(([id, count]) => ({ id, count })) };
}

/**
 * Reads the attached files. Tables, text and one tasks file are understood; anything else is
 * refused with a sentence that says what to attach instead. Nothing is returned for a file that
 * can't be read, since a draft made from part of the files would say more than they do.
 */
export async function readAttachments(paths: readonly string[]): Promise<Attached> {
  const unique = [...new Map(paths.map((path) => [resolve(path), path])).values()];
  if (unique.length > MAX_FILES) {
    throw new Error(`Architect reads up to ${MAX_FILES} files at once. Attach fewer.`);
  }
  const files: Attachment[] = [];
  let tasks: TasksFile | null = null;
  const taken = new Set<string>();
  let total = 0;
  for (const path of unique) {
    const original = basename(path);
    const extension = extname(original).toLowerCase();
    const known =
      TABLE_EXTENSIONS.has(extension) ||
      TEXT_EXTENSIONS.has(extension) ||
      TASK_EXTENSIONS.has(extension);
    if (!known) {
      const what = NOT_YET[extension];
      throw new Error(
        what === undefined
          ? `${original} isn't a file Architect can read yet. It reads CSV, text and Markdown files.`
          : `${original} is ${what}. Architect reads CSV, text and Markdown files for now. Save or export it as one of those, then attach that.`,
      );
    }
    const info = await stat(path).catch(() => null);
    if (info === null || !info.isFile()) {
      throw new Error(`${original} can't be opened. Check that it is still where you left it.`);
    }
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(
        `${original} is ${Math.ceil(info.size / (1024 * 1024))} MB, more than the ${MAX_FILE_BYTES / (1024 * 1024)} MB Architect reads from one file. Attach a smaller part of it.`,
      );
    }
    total += info.size;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(
        `The files add up to more than ${MAX_TOTAL_BYTES / (1024 * 1024)} MB. Attach fewer or smaller ones.`,
      );
    }
    const bytes = await readFile(path);
    if (looksBinary(bytes)) {
      throw new Error(
        `${original} looks like a binary file, not text. Architect reads text files.`,
      );
    }
    const text = bytes.toString('utf8').replace(/^\u{feff}/u, '');
    if (TASK_EXTENSIONS.has(extension)) {
      if (tasks !== null) {
        throw new Error('Attach one tasks file. Two were attached.');
      }
      tasks = readTasks(original, text);
      continue;
    }
    const name = uniqueName(safeName(original), taken);
    taken.add(name.toLowerCase());
    files.push(
      TABLE_EXTENSIONS.has(extension)
        ? { name, kind: 'table', bytes, table: readTable(name, text) }
        : { name, kind: 'text', bytes, text },
    );
  }
  return { files, tasks };
}

/** Each attached file's name and the hash of its bytes. */
export function hashesOf(attached: Attached): { name: string; sha256: string }[] {
  return attached.files.map((file) => ({
    name: file.name,
    sha256: createHash('sha256').update(file.bytes).digest('hex'),
  }));
}

/** The hash of everything attached, for a seed that follows from the files. */
export function digestOf(attached: Attached): string[] {
  return [
    ...hashesOf(attached).map(({ name, sha256 }) => `${name}:${sha256}`),
    ...(attached.tasks === null
      ? []
      : [
          `${attached.tasks.name}:${attached.tasks.tasks.length}:${attached.tasks.types.map((t) => `${t.id}=${t.count}`).join(',')}`,
        ]),
  ];
}

/** Rows a table has across all attachments. */
export function totalRows(attached: Attached): number {
  return attached.files.reduce((sum, file) => sum + (file.table?.rows.length ?? 0), 0);
}

const FIRST_ROWS = 5;
const CELL_WIDTH = 40;
const WIDE_PROFILE = 30;
const WIDE_ROWS = 12;

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 3)}...` : text;
}

function describeColumn(profile: ColumnProfile): string {
  const kind =
    profile.kind === 'number'
      ? profile.decorated
        ? 'numbers, some written with currency signs or separators'
        : 'numbers'
      : profile.kind === 'date'
        ? 'dates'
        : 'text';
  const variety = profile.unique
    ? 'every value different'
    : profile.filled === 0
      ? 'no values'
      : `${profile.distinctCapped ? `over ${profile.distinct}` : profile.distinct} different value${profile.distinct === 1 ? '' : 's'}`;
  const empty = profile.empty > 0 ? `, ${profile.empty} empty` : '';
  const examples = profile.samples.length > 0 ? `. Examples: ${profile.samples.join(' | ')}` : '';
  return `- ${profile.name}: ${kind}, ${variety}${empty}${examples}`;
}

/** What the teacher is told of a table: its shape, each column, and the first rows. */
export function describeTable(file: Attachment, budget: number): string {
  const table = file.table;
  if (table === undefined) return '';
  const shown = table.columns.slice(0, WIDE_PROFILE);
  const profiles = shown.map((column) => describeColumn(profileColumn(table, column)));
  const more =
    table.columns.length > shown.length
      ? [
          `- ${table.columns.length - shown.length} more columns: ${table.columns.slice(shown.length).join(', ')}`,
        ]
      : [];
  const rowColumns = table.columns.slice(0, WIDE_ROWS);
  const rows = table.rows
    .slice(0, FIRST_ROWS)
    .map((row) => rowColumns.map((column) => clip(cleanText(row[column]), CELL_WIDTH)).join(' | '));
  const text = [
    `### ${file.name} (a table)`,
    `${table.rows.length.toLocaleString('en-US')} rows, ${table.columns.length} columns.`,
    'Columns:',
    ...profiles,
    ...more,
    `First rows (${rowColumns.join(' | ')}):`,
    ...rows,
  ].join('\n');
  return text.length > budget ? `${text.slice(0, budget - 40)}\n[The rest is left out.]` : text;
}

/**
 * What the teacher is told of a text file: all of it. A rule read from part of a policy can leave
 * out the exception that matters, so a text is given whole or the job isn't drafted
 * (`textTooLong`).
 */
export function describeText(file: Attachment): string {
  const text = file.text ?? '';
  const header = `### ${file.name} (text, ${text.length.toLocaleString('en-US')} characters)`;
  return `${header}\n${text.trim()}`;
}

/**
 * Why the text files can't be given to the teacher whole, or null when they can. Nothing is cut
 * to fit: the person is asked for the section that matters instead.
 */
export function textTooLong(attached: Attached): string | null {
  const { maxTextChars, maxTotalTextChars } = DRAFTING_LIMITS;
  const number = (value: number) => value.toLocaleString('en-US');
  const texts = attached.files.filter((file) => file.kind === 'text');
  for (const file of texts) {
    const length = file.text?.length ?? 0;
    if (length > maxTextChars) {
      return `${file.name} is ${number(length)} characters long, more than the ${number(maxTextChars)} Architect reads from one text file. A rule read from part of a policy can leave out the exception that matters, so Architect won't use part of it. Attach just the section the job needs, such as the part on pricing, and describe the job again.`;
    }
  }
  const total = texts.reduce((sum, file) => sum + (file.text?.length ?? 0), 0);
  if (total > maxTotalTextChars) {
    return `Your text files add up to ${number(total)} characters, more than the ${number(maxTotalTextChars)} Architect reads in all. Attach only the sections the job needs, and describe the job again.`;
  }
  return null;
}

/** What the teacher is told of a tasks file: only how many tasks and of which types. */
export function describeTasks(file: TasksFile): string {
  const types = file.types.map((type) => `${type.count} of type "${type.id}"`).join(', ');
  return [
    `### ${file.name} (example tasks)`,
    `The person attached ${file.tasks.length} example tasks with their answers: ${types}.`,
    'Architect will use them as they are, to train and test the agent. You are not shown them, and you do not write tasks.',
  ].join('\n');
}

/** Characters of table descriptions the teacher is sent in all, at most. */
const TABLES_BUDGET = 40_000;

/**
 * Everything the teacher is told of the attached files: a profile and the first rows of each
 * table within a size that keeps its answer quick, and every text whole.
 */
export function describeAttached(attached: Attached): string {
  const tables = attached.files.filter((file) => file.kind === 'table');
  const perTable = Math.max(2_500, Math.floor(TABLES_BUDGET / Math.max(1, tables.length)));
  return [
    ...attached.files.map((file) =>
      file.kind === 'table' ? describeTable(file, perTable) : describeText(file),
    ),
    ...(attached.tasks === null ? [] : [describeTasks(attached.tasks)]),
  ].join('\n\n');
}
