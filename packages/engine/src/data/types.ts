import type { DataFile } from '@architect/shared';

/** A table row as stored: every cell is text, and an empty cell is null. */
export type Row = Readonly<Record<string, string | null>>;

/** A table's columns and rows at one moment. Both arrays are frozen, so they can be shared. */
export interface TableSnapshot {
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
}

/** What the agent can learn about a data file without reading it. */
export interface FileInfo {
  name: string;
  kind: DataFile['kind'];
  access: DataFile['access'];
  description?: string;
  /** Row count, for tables. */
  rows?: number;
  /** Column names, for tables. */
  columns?: string[];
}
