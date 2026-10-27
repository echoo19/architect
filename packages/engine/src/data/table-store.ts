import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  GuardError,
  type CellValue,
  type DataFile,
  type RowDiff,
  type WhereClause,
} from '@architect/shared';
import { toCell } from './cells';
import { parseCsv, serializeCsv, type CsvFormat } from './csv';
import { DataError } from './errors';
import { assertColumns, rowMatcher, selectRows, type RowSelection } from './query';
import type { FileInfo, Row, TableSnapshot } from './types';

export type StoreMode = 'scratch' | 'live';

export interface TableStoreOptions {
  /** The job's data folder. Declared file names are relative to it. */
  dataDir: string;
  files: readonly DataFile[];
  /** `scratch` keeps writes in memory only; `live` can commit them back to the files. */
  mode: StoreMode;
}

export interface ReadOptions extends RowSelection {
  /** Rows to return, from 0 to 200. Defaults to 50. */
  limit?: number;
  offset?: number;
}

export interface ReadResult {
  columns: string[];
  rows: Row[];
  /** Rows matching the conditions, before offset and limit. */
  total: number;
  /** True when more matching rows come after the returned ones. */
  truncated: boolean;
}

/** A write that has been checked and diffed but not applied, so it can be shown for approval. */
export interface PlannedWrite {
  readonly file: string;
  readonly kind: 'append' | 'update';
  /** One line for people, e.g. "Append 1 row to invoices.csv". */
  readonly summary: string;
  readonly diff: RowDiff;
  /** Rows the write reaches: the rows appended, or the rows an update's conditions match. */
  readonly matched: number;
  /** Rows whose values actually change. */
  readonly changed: number;
}

export interface TableChange {
  file: string;
  diff: RowDiff;
}

/** The job's declared data files, with permissions enforced on every read and write. */
export interface TableStore {
  readonly mode: StoreMode;
  listFiles(): FileInfo[];
  read(file: string, options?: ReadOptions): ReadResult;
  readText(file: string): string;
  planAppend(file: string, rows: readonly unknown[]): PlannedWrite;
  planUpdate(
    file: string,
    where: readonly WhereClause[],
    set: Readonly<Record<string, unknown>>,
  ): PlannedWrite;
  /** Applies a planned write, unless the table changed since it was planned. */
  apply(plan: PlannedWrite): void;
  append(file: string, rows: readonly unknown[]): PlannedWrite;
  update(
    file: string,
    where: readonly WhereClause[],
    set: Readonly<Record<string, unknown>>,
  ): PlannedWrite;
  /** The table's rows as loaded (or as last committed). */
  original(file: string): readonly Row[];
  /** Every table as it is now. */
  snapshot(): Record<string, TableSnapshot>;
  /** Differences from the original rows, for each table that has any. */
  pendingChanges(): TableChange[];
  /** Live stores only: writes every changed table to disk and returns the files written. */
  commit(): string[];
  /** Drops every pending change. */
  discard(): void;
}

export const DEFAULT_READ_LIMIT = 50;
export const MAX_READ_LIMIT = 200;

interface TableState {
  readonly file: DataFile;
  readonly path: string;
  readonly columns: readonly string[];
  readonly format: CsvFormat;
  original: readonly Row[];
  rows: readonly Row[];
  /** For each current row, the index of the original row it came from, or null if appended. */
  origins: readonly (number | null)[];
  version: number;
}

interface PlanState {
  readonly table: TableState;
  readonly version: number;
  readonly rows: readonly Row[];
  readonly origins: readonly (number | null)[];
}

const BOM = '﻿';

/** Loads the declared files. Undeclared files can't be read or written through the store. */
export async function openTableStore(options: TableStoreOptions): Promise<TableStore> {
  const names = options.files.map((file) => file.name);
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) throw new DataError(`${twice} is declared twice in the job.`);

  const loaded = await Promise.all(
    options.files.map(async (file) => ({
      file,
      ...(await readDataFile(options.dataDir, file.name)),
    })),
  );
  const tables = new Map<string, TableState>();
  const texts = new Map<string, string>();
  for (const { file, path, content } of loaded) {
    if (file.kind === 'text') {
      texts.set(file.name, content.startsWith(BOM) ? content.slice(1) : content);
      continue;
    }
    const parsed = parseCsv(file.name, content);
    const rows = Object.freeze(parsed.rows);
    tables.set(file.name, {
      file,
      path,
      columns: Object.freeze(parsed.columns),
      format: parsed.format,
      original: rows,
      rows,
      origins: identityOrigins(rows.length),
      version: 0,
    });
  }
  return new DeclaredTableStore(options.mode, options.files, tables, texts);
}

class DeclaredTableStore implements TableStore {
  private readonly plans = new WeakMap<PlannedWrite, PlanState>();

  constructor(
    readonly mode: StoreMode,
    private readonly declared: readonly DataFile[],
    private readonly tables: Map<string, TableState>,
    private readonly texts: Map<string, string>,
  ) {}

  listFiles(): FileInfo[] {
    return this.declared.map((file) => {
      const info: FileInfo = { name: file.name, kind: file.kind, access: file.access };
      if (file.description !== undefined) info.description = file.description;
      const table = this.tables.get(file.name);
      if (table) {
        info.rows = table.rows.length;
        info.columns = [...table.columns];
      }
      return info;
    });
  }

  read(file: string, options: ReadOptions = {}): ReadResult {
    const table = this.table(file);
    const limit = readLimit(options.limit);
    const offset = options.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new DataError('offset must be a whole number, 0 or more.');
    }
    const selected = selectRows(file, table, options);
    const rows = selected.rows.slice(offset, offset + limit);
    return {
      columns: selected.columns,
      rows,
      total: selected.rows.length,
      truncated: offset + rows.length < selected.rows.length,
    };
  }

  readText(file: string): string {
    const declared = this.declaredFile(file);
    const text = this.texts.get(declared.name);
    if (text === undefined) throw new DataError(`${file} is a table, not a text file.`);
    return text;
  }

  planAppend(file: string, rows: readonly unknown[]): PlannedWrite {
    const table = this.writableTable(file);
    if (rows.length === 0) throw new DataError('Give at least one row to append.');
    const added = rows.map((input, index) => toRow(table, input, `Row ${index + 1}`));
    const summary = `Append ${count(added.length, 'row')} to ${file}`;
    return this.plan(
      table,
      {
        kind: 'append',
        summary,
        diff: {
          columns: [...table.columns],
          added: added.map((row) => cells(table.columns, row)),
          removed: [],
          changed: [],
        },
        matched: added.length,
        changed: added.length,
      },
      [...table.rows, ...added],
      [...table.origins, ...added.map(() => null)],
    );
  }

  planUpdate(
    file: string,
    where: readonly WhereClause[],
    set: Readonly<Record<string, unknown>>,
  ): PlannedWrite {
    const table = this.writableTable(file);
    if (where.length === 0) {
      throw new DataError(
        "Give at least one where condition, so an update can't change every row by accident.",
      );
    }
    const entries = Object.entries(set);
    if (entries.length === 0) throw new DataError('Give at least one column to set.');
    assertColumns(
      file,
      table,
      entries.map(([column]) => column),
    );
    assertColumns(
      file,
      table,
      where.map((clause) => clause.column),
    );
    const values = Object.fromEntries(
      entries.map(([column, value]) => [column, toCell(value, `The value for ${column}`)]),
    );

    const matches = rowMatcher(where);
    const changed: RowDiff['changed'] = [];
    let matched = 0;
    const rows = table.rows.map((row) => {
      if (!matches(row)) return row;
      matched += 1;
      const updated = Object.freeze({ ...row, ...values });
      if (sameCells(table.columns, row, updated)) return row;
      changed.push({ before: cells(table.columns, row), after: cells(table.columns, updated) });
      return updated;
    });
    return this.plan(
      table,
      {
        kind: 'update',
        summary: updateSummary(file, matched, changed.length),
        diff: { columns: [...table.columns], added: [], removed: [], changed },
        matched,
        changed: changed.length,
      },
      rows,
      table.origins,
    );
  }

  apply(plan: PlannedWrite): void {
    const state = this.plans.get(plan);
    if (!state) throw new Error('This write was planned by a different store.');
    if (state.table.version !== state.version) {
      throw new DataError(`${plan.file} changed after this write was planned; plan it again.`);
    }
    if (plan.changed === 0) return;
    state.table.rows = state.rows;
    state.table.origins = state.origins;
    state.table.version += 1;
  }

  append(file: string, rows: readonly unknown[]): PlannedWrite {
    const plan = this.planAppend(file, rows);
    this.apply(plan);
    return plan;
  }

  update(
    file: string,
    where: readonly WhereClause[],
    set: Readonly<Record<string, unknown>>,
  ): PlannedWrite {
    const plan = this.planUpdate(file, where, set);
    this.apply(plan);
    return plan;
  }

  original(file: string): readonly Row[] {
    return this.table(file).original;
  }

  snapshot(): Record<string, TableSnapshot> {
    return Object.fromEntries(
      [...this.tables].map(([name, table]) => [name, { columns: table.columns, rows: table.rows }]),
    );
  }

  pendingChanges(): TableChange[] {
    return [...this.tables.values()].flatMap((table) => {
      const diff = diffTable(table);
      return diff ? [{ file: table.file.name, diff }] : [];
    });
  }

  commit(): string[] {
    if (this.mode !== 'live') {
      throw new Error('Only a live store writes to disk; this one is a scratch copy.');
    }
    const written: string[] = [];
    for (const table of this.tables.values()) {
      if (!diffTable(table)) continue;
      writeFileAtomic(table.path, serializeCsv(table.columns, table.rows, table.format));
      table.original = table.rows;
      table.origins = identityOrigins(table.rows.length);
      written.push(table.file.name);
    }
    return written;
  }

  discard(): void {
    for (const table of this.tables.values()) {
      if (table.rows === table.original) continue;
      table.rows = table.original;
      table.origins = identityOrigins(table.original.length);
      table.version += 1;
    }
  }

  private plan(
    table: TableState,
    fields: Omit<PlannedWrite, 'file'>,
    rows: readonly Row[],
    origins: readonly (number | null)[],
  ): PlannedWrite {
    const plan: PlannedWrite = Object.freeze({ file: table.file.name, ...fields });
    this.plans.set(plan, {
      table,
      version: table.version,
      rows: Object.freeze(rows),
      origins: Object.freeze(origins),
    });
    return plan;
  }

  private declaredFile(file: string): DataFile {
    const declared = this.declared.find((candidate) => candidate.name === file);
    if (!declared) {
      const names = this.declared.map((candidate) => candidate.name).join(', ');
      throw new GuardError(
        'permission',
        `"${file}" is not one of this job's data files. The files are: ${names}.`,
      );
    }
    return declared;
  }

  private table(file: string): TableState {
    const table = this.tables.get(this.declaredFile(file).name);
    if (!table) throw new DataError(`${file} is a text file, not a table.`);
    return table;
  }

  private writableTable(file: string): TableState {
    const declared = this.declaredFile(file);
    if (declared.access !== 'write') {
      const writable = this.declared.filter((candidate) => candidate.access === 'write');
      const hint =
        writable.length === 0
          ? 'No file can be changed in this job.'
          : `Only ${writable.map((candidate) => candidate.name).join(', ')} can be changed.`;
      throw new GuardError('permission', `${file} is read-only for this job. ${hint}`);
    }
    return this.table(file);
  }
}

async function readDataFile(
  dataDir: string,
  name: string,
): Promise<{ path: string; content: string }> {
  const root = resolve(dataDir);
  const path = resolve(root, name);
  const inside = relative(root, path);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new GuardError('permission', `${name} is outside the job's data folder.`);
  }
  try {
    return { path, content: await readFile(path, 'utf8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new DataError(`${name} is declared in the job but missing from its data folder.`);
    }
    throw error;
  }
}

function toRow(table: TableState, input: unknown, label: string): Row {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DataError(`${label} must be an object of column names to values.`);
  }
  const entries = Object.entries(input);
  assertColumns(
    table.file.name,
    table,
    entries.map(([column]) => column),
  );
  const values = Object.fromEntries(
    entries.map(([column, value]) => [column, toCell(value, `${label}, column ${column},`)]),
  );
  return Object.freeze(
    Object.fromEntries(table.columns.map((column) => [column, values[column] ?? null])),
  );
}

function diffTable(table: TableState): RowDiff | null {
  const added: CellValue[][] = [];
  const changed: RowDiff['changed'] = [];
  const kept = new Set<number>();
  table.rows.forEach((row, index) => {
    const origin = table.origins[index] ?? null;
    if (origin === null) {
      added.push(cells(table.columns, row));
      return;
    }
    kept.add(origin);
    const before = table.original[origin];
    if (before && !sameCells(table.columns, before, row)) {
      changed.push({ before: cells(table.columns, before), after: cells(table.columns, row) });
    }
  });
  const removed = table.original
    .filter((_, index) => !kept.has(index))
    .map((row) => cells(table.columns, row));
  if (added.length + changed.length + removed.length === 0) return null;
  return { columns: [...table.columns], added, removed, changed };
}

function writeFileAtomic(path: string, content: string): void {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = openSync(temp, 'w');
    try {
      writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function readLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_READ_LIMIT;
  if (!Number.isInteger(limit) || limit < 0)
    throw new DataError('limit must be a whole number, 0 or more.');
  return Math.min(limit, MAX_READ_LIMIT);
}

function updateSummary(file: string, matched: number, changed: number): string {
  if (changed > 0) return `Update ${count(changed, 'row')} in ${file}`;
  if (matched === 0) return `No rows in ${file} match`;
  return `No change: the ${count(matched, 'matching row')} in ${file} already ${matched === 1 ? 'has' : 'have'} these values`;
}

function cells(columns: readonly string[], row: Row): CellValue[] {
  return columns.map((column) => row[column] ?? null);
}

function sameCells(columns: readonly string[], a: Row, b: Row): boolean {
  return columns.every((column) => (a[column] ?? null) === (b[column] ?? null));
}

function identityOrigins(length: number): readonly number[] {
  return Object.freeze(Array.from({ length }, (_, index) => index));
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
