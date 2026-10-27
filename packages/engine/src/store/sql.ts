import type { DatabaseSync, SQLInputValue, SQLOutputValue, StatementSync } from 'node:sqlite';

export type Row = Record<string, SQLOutputValue>;
export type Params = Record<string, SQLInputValue>;

/**
 * Prepared statements cached by their SQL. INSERT and UPDATE statements are built from the keys
 * of the params object, because `node:sqlite` binds a missing named parameter as NULL instead
 * of failing.
 */
export class Statements {
  private readonly cache = new Map<string, StatementSync>();

  constructor(private readonly db: DatabaseSync) {}

  private prepare(sql: string): StatementSync {
    let statement = this.cache.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.cache.set(sql, statement);
    }
    return statement;
  }

  all(sql: string, params: Params = {}): Row[] {
    return this.prepare(sql).all(params);
  }

  one(sql: string, params: Params = {}): Row | null {
    return this.prepare(sql).get(params) ?? null;
  }

  run(sql: string, params: Params = {}): number {
    return Number(this.prepare(sql).run(params).changes);
  }

  insert(table: string, params: Params, onConflict: 'fail' | 'replace' = 'fail'): void {
    const columns = Object.keys(params);
    const verb = onConflict === 'replace' ? 'INSERT OR REPLACE' : 'INSERT';
    this.run(
      `${verb} INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `:${c}`).join(', ')})`,
      params,
    );
  }

  /** Updates the row identified by the `key` columns and fails unless exactly one row changed. */
  update(table: string, params: Params, key: readonly string[]): void {
    const set = Object.keys(params)
      .filter((column) => !key.includes(column))
      .map((column) => `${column} = :${column}`);
    const where = key.map((column) => `${column} = :${column}`);
    const changed = this.run(
      `UPDATE ${table} SET ${set.join(', ')} WHERE ${where.join(' AND ')}`,
      params,
    );
    if (changed !== 1) throw new Error(`No ${table} row matched ${key.join(', ')}`);
  }
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** Parses a JSON column. `undefined` means the column isn't in the row, which is a bug. */
export function fromJson(value: SQLOutputValue | undefined): unknown {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Expected a JSON text column');
  return JSON.parse(value);
}

/** Named placeholders and params for an `IN (...)` list. */
export function inList(
  prefix: string,
  values: readonly SQLInputValue[],
): { placeholders: string; params: Params } {
  const names = values.map((_, i) => `${prefix}${i}`);
  return {
    placeholders: names.map((name) => `:${name}`).join(', '),
    params: Object.fromEntries(names.map((name, i) => [name, values[i] ?? null])),
  };
}

/** NULL columns map to absent optional fields. */
export function orUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

export function flag(value: boolean): number {
  return value ? 1 : 0;
}
