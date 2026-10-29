import type { Expected, JsonValue } from '@architect/shared';
import { findColumn, type Table } from '../table';
import { cleanText } from '../values';

/** One request Architect can make, with the answer it worked out and what it depends on. */
export interface Candidate {
  /** Requests with the same family land in the same split. */
  family: string;
  /**
   * The business question the request asks, in one text that doesn't depend on how the kind of
   * task was configured. Two requests with the same identity ask the same thing, whatever order
   * their conditions were written in and whichever kind of task made them, so only one is kept:
   * a question in the practice tasks and again in the final test would give the answer away.
   */
  identity: string;
  /**
   * The rows of the table, by position, that decide the answer: the one a request is about, or the
   * ones a list names or a total adds up (all the rows it looked at, when none of them counts).
   * When the teacher was shown every one of them while drafting, the shown rows decide the answer
   * and the request is left out, since nothing may be asked whose answer the teacher has already
   * read. With one of them unshown the answer is still the teacher's to work out, and it is kept.
   */
  rows?: readonly number[];
  /** The request, ending with the line that states the answer's shape. */
  prompt: string;
  expected: Expected;
  /** The expected answer in one canonical text, so repeated answers can be counted. */
  answerKey: string;
  meta: Record<string, JsonValue>;
}

/** What a task specification comes to once it is held against its table. */
export interface TemplateRun<S> {
  /** The specification with its columns spelled as the table's header spells them. */
  spec: S;
  candidates: Candidate[];
  /**
   * Why the specification can't be used, in the words the teacher is told. Empty when it can. They
   * name columns and give counts, and never say a value of a row the teacher was not shown: any
   * row a set is made from may be the subject of a check or final-test task.
   */
  problems: string[];
  /**
   * A problem again with the values of the records in it, by the words the teacher is told. Only
   * the person reads these, who knows the records.
   */
  inFull?: ReadonlyMap<string, string>;
  /** What was assumed or skipped, in plain words. */
  notes: string[];
  /** The rule behind the requests, in words. */
  rule: string;
}

/**
 * Adds a problem in the two voices it is told in: `teacher` names columns and gives counts, and
 * `person` is the same with the values of the records that the teacher must not be told.
 */
export function addProblem(
  problems: string[],
  inFull: Map<string, string>,
  teacher: string,
  person: string,
): void {
  problems.push(teacher);
  inFull.set(teacher, person);
}

/** The longest request a teacher may write, in characters. */
export const MAX_REQUEST_CHARS = 400;

/** The columns of a table, for a message that says which one was meant. */
export function columnList(table: Table): string {
  const shown = table.columns.slice(0, 12).join(', ');
  return table.columns.length > 12 ? `${shown} and ${table.columns.length - 12} more` : shown;
}

/**
 * The header a name stands for, or a problem saying what the table has instead. `role` says what
 * the column was named for ("the key column").
 */
export function needColumn(
  table: Table,
  wanted: string,
  role: string,
  problems: string[],
): string | null {
  const found = findColumn(table, wanted);
  if (found === null) {
    problems.push(
      `${role} "${wanted}" isn't a column of ${table.name}. Its columns are ${columnList(table)}.`,
    );
  }
  return found;
}

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** The names in `{braces}` in a request. */
export function placeholdersOf(request: string): string[] {
  return [...request.matchAll(PLACEHOLDER)].map((found) => found[1] ?? '');
}

/**
 * Holds a request's wording to the names it may use. Every name in `required` must appear, no
 * other name or stray brace may, the request must be one short line, and it must not carry the
 * line that marks an answer.
 */
export function checkRequest(
  request: string,
  allowed: readonly string[],
  required: readonly string[],
  problems: string[],
): void {
  if (request.length > MAX_REQUEST_CHARS) {
    problems.push(`The request is longer than ${MAX_REQUEST_CHARS} characters.`);
  }
  if (/ANSWER:/i.test(request)) {
    problems.push('The request must not contain "ANSWER:"; Architect adds the answer line itself.');
  }
  const names = placeholdersOf(request);
  for (const name of names) {
    if (!allowed.includes(name)) {
      problems.push(
        `The request uses {${name}}, which this kind of task doesn't fill in. It can use ${allowed.map((item) => `{${item}}`).join(', ')}.`,
      );
    }
  }
  for (const name of required) {
    if (!names.includes(name)) problems.push(`The request must contain {${name}}.`);
  }
  if (request.replace(PLACEHOLDER, '').match(/[{}]/)) {
    problems.push('The request has a brace that is not part of a name such as {key}.');
  }
}

/** The request with each `{name}` replaced by its value, set on one line. */
export function fillRequest(request: string, values: Readonly<Record<string, string>>): string {
  return request
    .replace(PLACEHOLDER, (_whole, name: string) => values[name] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A column's name as a key in an answer: lowercase words joined by underscores. */
export function answerKeyName(column: string): string {
  const key = cleanText(column)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key === '' ? 'value' : /^[0-9]/.test(key) ? `_${key}` : key;
}

/** Each column's answer key, made different from the others by a number when two would match. */
export function answerKeyNames(columns: readonly string[]): string[] {
  const used = new Set<string>();
  return columns.map((column) => {
    const base = answerKeyName(column);
    let name = base;
    for (let next = 2; used.has(name); next += 1) name = `${base}_${next}`;
    used.add(name);
    return name;
  });
}

/**
 * The spellings a column's values take, one per value counted without regard to case or spacing:
 * the one that appears most, and the first when two tie.
 */
export function spellings(cells: Iterable<string | null>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const cell of cells) {
    const text = cleanText(cell);
    if (text === '') continue;
    const key = text.toLowerCase();
    const forms = counts.get(key) ?? new Map<string, number>();
    forms.set(text, (forms.get(text) ?? 0) + 1);
    counts.set(key, forms);
  }
  const chosen = new Map<string, string>();
  for (const [key, forms] of counts) {
    let best = '';
    let most = 0;
    for (const [form, count] of forms) {
      if (count > most) {
        best = form;
        most = count;
      }
    }
    chosen.set(key, best);
  }
  return chosen;
}

/** A list in words: `a`, `a and b`, `a, b and c`; with `or`, `a, b or c`. */
export function inWords(items: readonly string[], joiner: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}

/** One canonical text for a JSON value, with object keys in order. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
