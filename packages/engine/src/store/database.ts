import { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Runs `fn` inside one transaction, or inside the caller's if one is already open. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function appliedVersions(db: DatabaseSync): Set<number> {
  const rows = db.prepare('SELECT version FROM migrations').all();
  return new Set(rows.map((row) => Number(row.version)));
}

/** Applies every migration not yet recorded, in version order, each in its own transaction. */
export function migrate(db: DatabaseSync, migrations: readonly Migration[]): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = appliedVersions(db);
  const record = db.prepare(
    'INSERT INTO migrations (version, name, applied_at) VALUES (:version, :name, :applied_at)',
  );
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    inTransaction(db, () => {
      db.exec(migration.sql);
      record.run({
        version: migration.version,
        name: migration.name,
        applied_at: new Date().toISOString(),
      });
    });
  }
}

/** Opens the database with write-ahead logging and foreign keys on, then migrates it. */
export function openDatabase(file: string, migrations: readonly Migration[]): DatabaseSync {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5_000 });
  try {
    db.exec('PRAGMA journal_mode = WAL');
    migrate(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
