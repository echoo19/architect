import type { CaseTable, CounterexamplePredicate, JsonValue } from '@architect/shared';
import { normalText, sameValue, type Scalar } from './predicate';

/** The inputs a helper is run on: its tables and its text files. */
export interface CaseData {
  tables: Record<string, CaseTable>;
  texts: Record<string, string>;
}

/** Sandbox runs a reduction may take before it stops and calls its result `reduced`. */
export const DEFAULT_MAX_STEPS = 400;

export interface ReduceInput {
  data: CaseData;
  /** The call's arguments: the rows they point at are kept. */
  args: Record<string, JsonValue>;
  predicate: CounterexamplePredicate;
  /** The helper's code, for the files it names. */
  code: string;
  /** The checker's expected values, whose columns are kept. */
  expected: Record<string, Scalar>;
  /** Runs the helper on a candidate in the sandbox: whether the same failure still holds. */
  holds(candidate: CaseData): Promise<boolean>;
  maxSteps?: number;
}

export interface Reduction {
  data: CaseData;
  /** Every remaining row and column was tried on its own and is needed. */
  minimal: boolean;
  steps: number;
}

type Kept = Map<string, Set<number>>;

class Budget {
  steps = 0;
  constructor(private readonly max: number) {}
  get spent(): boolean {
    return this.steps >= this.max;
  }
}

/**
 * Delta debugging (Zeller and Hildebrandt 2002): the smallest subset of `units` it can find for
 * which `test` still holds, trying chunks and their complements at doubling granularity. Complete
 * means it ended with every single unit tried, so the result is 1-minimal.
 */
async function ddmin<T>(
  units: readonly T[],
  test: (kept: readonly T[]) => Promise<boolean>,
  budget: Budget,
): Promise<{ kept: T[]; complete: boolean }> {
  let current = [...units];
  if (current.length === 0) return { kept: current, complete: true };
  if (budget.spent) return { kept: current, complete: false };
  budget.steps += 1;
  if (await test([])) return { kept: [], complete: true };
  let n = 2;
  while (current.length >= 2) {
    const chunks = split(current, n);
    let next: T[] | null = null;
    let granularity = n;
    for (const chunk of chunks) {
      if (budget.spent) return { kept: current, complete: false };
      budget.steps += 1;
      if (await test(chunk)) {
        next = chunk;
        granularity = 2;
        break;
      }
    }
    if (next === null && n > 2) {
      for (const chunk of chunks) {
        const complement = current.filter((unit) => !chunk.includes(unit));
        if (budget.spent) return { kept: current, complete: false };
        budget.steps += 1;
        if (await test(complement)) {
          next = complement;
          granularity = Math.max(n - 1, 2);
          break;
        }
      }
    }
    if (next !== null) {
      current = next;
      n = granularity;
      continue;
    }
    if (n >= current.length) break;
    n = Math.min(current.length, n * 2);
  }
  return { kept: current, complete: true };
}

function split<T>(units: readonly T[], n: number): T[][] {
  const chunks: T[][] = [];
  const size = units.length / n;
  for (let i = 0; i < n; i += 1) {
    const chunk = units.slice(Math.round(i * size), Math.round((i + 1) * size));
    if (chunk.length > 0) chunks.push(chunk);
  }
  return chunks;
}

function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The tables the code names in quotes (`'tests.csv'` or `"tests"`); all of them if it names none. */
export function namedTables(code: string, tables: readonly string[]): string[] {
  const named = tables.filter((name) =>
    new RegExp(`['"\`]${escaped(stemOf(name))}(\\.[a-z]+)?['"\`]`, 'i').test(code),
  );
  return named.length === 0 ? [...tables] : named;
}

/** The call's single values, each with its argument's name, as text with spaces and case set aside. */
function argumentValues(args: Record<string, JsonValue>): { name: string; value: string }[] {
  return Object.entries(args).flatMap(([name, value]) =>
    (typeof value === 'string' || typeof value === 'number') && String(value).trim() !== ''
      ? [{ name: name.toLowerCase(), value: normalText(String(value)) }]
      : [],
  );
}

/**
 * How much of the call a row holds: how many of its values are in the row's cells, then, to
 * break ties, how many are in the column named like their argument.
 */
function callScore(
  row: CaseTable['rows'][number],
  args: readonly { name: string; value: string }[],
): number {
  const cells = new Set(
    Object.values(row).flatMap((cell) => (cell === null ? [] : [normalText(cell)])),
  );
  const held = new Set(args.filter((arg) => cells.has(arg.value)).map((arg) => arg.value)).size;
  const named = args.filter((arg) =>
    Object.entries(row).some(
      ([column, cell]) =>
        column.toLowerCase() === arg.name && cell !== null && normalText(cell) === arg.value,
    ),
  ).length;
  return held * 1000 + named;
}

/**
 * The rows a reduction never removes: the rows the call points at, in the tables the helper's
 * code names. A crash needs only the rows that hold the most of the call's values (a lookup's
 * test, module and number); a wrong value may depend on every row that holds any of them (each
 * of a student's answers on a topic), so all of those stay.
 */
export function anchorRows(input: Pick<ReduceInput, 'data' | 'args' | 'predicate' | 'code'>): Kept {
  const names = namedTables(input.code, Object.keys(input.data.tables));
  const args = argumentValues(input.args);
  const scores = new Map<string, number[]>();
  for (const name of names) {
    const table = input.data.tables[name];
    if (table)
      scores.set(
        name,
        table.rows.map((row) => callScore(row, args)),
      );
  }
  const best = Math.max(0, ...[...scores.values()].flat());
  const anchors: Kept = new Map();
  if (best < 1000) return anchors;
  const least = input.predicate.kind === 'threw' ? best : 1000;
  for (const [name, rowScores] of scores) {
    const kept = new Set(rowScores.flatMap((score, index) => (score >= least ? [index] : [])));
    if (kept.size > 0) anchors.set(name, kept);
  }
  return anchors;
}

/** An id column: the first column, named `id` or `<thing>_id`, with a distinct value in every row. */
function idColumn(table: CaseTable): string | null {
  const first = table.columns[0];
  if (first === undefined || !/(^|_)id$/i.test(first)) return null;
  const values = table.rows.map((row) => row[first]);
  if (values.some((value) => value === null || value === undefined)) return null;
  return new Set(values).size === values.length ? first : null;
}

/** Each id to its row, for the tables that have ids. */
function idIndex(data: CaseData): Map<string, { table: string; row: number }> {
  const index = new Map<string, { table: string; row: number }>();
  for (const [name, table] of Object.entries(data.tables)) {
    const column = idColumn(table);
    if (column === null) continue;
    table.rows.forEach((row, at) => {
      const id = row[column];
      if (typeof id === 'string' && !index.has(id)) index.set(id, { table: name, row: at });
    });
  }
  return index;
}

function copy(kept: Kept): Kept {
  return new Map([...kept].map(([name, rows]) => [name, new Set(rows)]));
}

/** The kept rows with every row they reference by id in another table, until nothing is added. */
function closure(
  data: CaseData,
  ids: Map<string, { table: string; row: number }>,
  start: Kept,
): Kept {
  const kept = copy(start);
  const queue = [...kept].flatMap(([name, rows]) => [...rows].map((row) => ({ name, row })));
  while (queue.length > 0) {
    const { name, row } = queue.pop() as { name: string; row: number };
    for (const cell of Object.values(data.tables[name]?.rows[row] ?? {})) {
      if (cell === null) continue;
      const target = ids.get(cell);
      if (!target || target.table === name) continue;
      const rows = kept.get(target.table) ?? new Set<number>();
      if (rows.has(target.row)) continue;
      rows.add(target.row);
      kept.set(target.table, rows);
      queue.push({ name: target.table, row: target.row });
    }
  }
  return kept;
}

function build(
  data: CaseData,
  kept: Kept,
  dropped: ReadonlySet<string>,
  texts: Record<string, string>,
): CaseData {
  const tables: Record<string, CaseTable> = {};
  for (const [name, table] of Object.entries(data.tables)) {
    const rows = [...(kept.get(name) ?? [])].sort((a, b) => a - b);
    const columns = table.columns.filter((column) => !dropped.has(`${name}\u0000${column}`));
    tables[name] = {
      columns,
      rows: rows.map((at) => {
        const row = table.rows[at] ?? {};
        return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
      }),
    };
  }
  return { tables, texts };
}

/**
 * The columns a crash's case keeps: those named like an argument, the id columns that join its
 * rows, and those that hold one of the checker's expected values in a kept row.
 */
function keptColumns(
  data: CaseData,
  args: Record<string, JsonValue>,
  expected: Record<string, Scalar>,
): Set<string> {
  const argNames = new Set(Object.keys(args).map((name) => name.toLowerCase()));
  const ids = new Set(
    Object.values(data.tables).flatMap((table) =>
      table.rows.flatMap((row) => {
        const column = idColumn(table);
        return column === null ? [] : [row[column]];
      }),
    ),
  );
  const keep = new Set<string>();
  for (const [name, table] of Object.entries(data.tables)) {
    for (const column of table.columns) {
      const cells = table.rows.map((row) => row[column] ?? null);
      if (
        argNames.has(column.toLowerCase()) ||
        cells.some((cell) => cell !== null && ids.has(cell)) ||
        cells.some(
          (cell) =>
            cell !== null && Object.values(expected).some((value) => sameValue(cell, value)),
        )
      ) {
        keep.add(`${name}\u0000${column}`);
      }
    }
  }
  return keep;
}

export function rowCount(data: CaseData): number {
  return Object.values(data.tables).reduce((sum, table) => sum + table.rows.length, 0);
}

export function columnCount(data: CaseData): number {
  return Object.values(data.tables).reduce((sum, table) => sum + table.columns.length, 0);
}

/**
 * Reduces a failing helper call's inputs while the same failure holds (docs/CERTIFY.md section
 * 2): the text files as one step, then rows, then, for a crash, columns, then tables left with
 * no rows. The rows the call points at stay, and every row a kept row references by id stays with
 * it. A wrong value keeps every column, since the value the checker expects may rest on any of
 * them. Deterministic for a deterministic `holds`; stops at the step cap.
 */
export async function reduceCase(input: ReduceInput): Promise<Reduction> {
  const { data } = input;
  const budget = new Budget(input.maxSteps ?? DEFAULT_MAX_STEPS);
  const ids = idIndex(data);
  const anchors = closure(data, ids, anchorRows(input));
  const all: Kept = new Map(
    Object.entries(data.tables).map(([name, table]) => [name, new Set(table.rows.keys())]),
  );
  const none = new Set<string>();
  let texts = data.texts;
  let complete = true;

  if (Object.keys(texts).length > 0 && !budget.spent) {
    budget.steps += 1;
    if (await input.holds(build(data, all, none, {}))) texts = {};
  }

  const units = [...all].flatMap(([name, rows]) =>
    [...rows].filter((row) => !anchors.get(name)?.has(row)).map((row) => ({ name, row })),
  );
  const keptOf = (chosen: readonly { name: string; row: number }[]): Kept => {
    const kept = copy(anchors);
    for (const { name, row } of chosen) {
      const rows = kept.get(name) ?? new Set<number>();
      rows.add(row);
      kept.set(name, rows);
    }
    return closure(data, ids, kept);
  };
  const rows = await ddmin(
    units,
    (chosen) => input.holds(build(data, keptOf(chosen), none, texts)),
    budget,
  );
  complete &&= rows.complete;
  const kept = keptOf(rows.kept);

  const dropped = new Set<string>();
  if (input.predicate.kind === 'threw') {
    const reduced = build(data, kept, none, texts);
    const keep = keptColumns(reduced, input.args, input.expected);
    const columnUnits = Object.entries(reduced.tables).flatMap(([name, table]) =>
      table.columns.map((column) => `${name}\u0000${column}`).filter((key) => !keep.has(key)),
    );
    const columns = await ddmin(
      columnUnits,
      (chosen) =>
        input.holds(
          build(data, kept, new Set(columnUnits.filter((key) => !chosen.includes(key))), texts),
        ),
      budget,
    );
    complete &&= columns.complete;
    for (const key of columnUnits) if (!columns.kept.includes(key)) dropped.add(key);
  }

  let result = build(data, kept, dropped, texts);
  const empty = Object.keys(result.tables).filter((name) => result.tables[name]?.rows.length === 0);
  if (empty.length > 0) {
    const without: CaseData = {
      texts,
      tables: Object.fromEntries(
        Object.entries(result.tables).filter(([name]) => !empty.includes(name)),
      ),
    };
    if (budget.spent) complete = false;
    else {
      budget.steps += 1;
      if (await input.holds(without)) result = without;
    }
  }
  return { data: result, minimal: complete, steps: budget.steps };
}
