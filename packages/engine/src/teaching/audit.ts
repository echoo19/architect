import type { MutationAudit, Task, WriteRecord } from '@architect/shared';
import { changedTables } from '../checker/checker';
import type { TableSnapshot } from '../data/types';

/** The tables as one write of the episode left them, and the model turn that made it. */
export interface WriteSnapshot {
  turn: number;
  tables: Readonly<Record<string, TableSnapshot>>;
}

export interface AuditInput {
  task: Task;
  /** The tables as the task began: the original data, before any replay. */
  original: Readonly<Record<string, TableSnapshot>>;
  /** The tables as the episode ended. */
  final: Readonly<Record<string, TableSnapshot>>;
  /** After each write of the correction, in order. */
  snapshots: readonly WriteSnapshot[];
  /** Every write of the episode, the student's prefix included. */
  writes: readonly WriteRecord[];
}

/** A row's cells as one comparable text. */
function rowKey(table: TableSnapshot, row: TableSnapshot['rows'][number]): string {
  return JSON.stringify(table.columns.map((column) => row[column] ?? null));
}

/** How many times each row occurs in a table. */
function rowCounts(table: TableSnapshot | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of table?.rows ?? []) {
    const key = rowKey(table as TableSnapshot, row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The original rows `final` still holds, each as often as both hold it. */
function keptRows(
  original: TableSnapshot | undefined,
  final: TableSnapshot | undefined,
): Map<string, number> {
  const before = rowCounts(original);
  const after = rowCounts(final);
  const kept = new Map<string, number>();
  for (const [key, count] of before) {
    const both = Math.min(count, after.get(key) ?? 0);
    if (both > 0) kept.set(key, both);
  }
  return kept;
}

/**
 * Checks what a correction did to the data along the way, not only where it ended, with the
 * checker's notion of a changed table (decision 036). A task that asks only for an answer may
 * change no table at any point. A task that writes may touch, at any point, only the tables its
 * end state changes, and never take away an original row its end state keeps. Every write must
 * have been applied. Text files and `output/` are outside the check, as they are for the checker.
 */
export function auditMutations(input: AuditInput): MutationAudit {
  const problems: string[] = [];
  const declined = input.writes.find((write) => !write.applied);
  if (declined) problems.push(`A write to ${declined.path} wasn't applied.`);

  const finalChanged = changedTables(input.original, input.final);
  const asksForAnswer = input.task.expected.kind !== 'end_state';
  if (asksForAnswer && finalChanged.length > 0) {
    problems.push(`${finalChanged[0]} changed, but the task asks only for an answer.`);
  }
  const allowed = new Set(asksForAnswer ? [] : finalChanged);
  const kept = new Map(
    finalChanged.map((name) => [name, keptRows(input.original[name], input.final[name])]),
  );

  for (const snapshot of input.snapshots) {
    for (const name of changedTables(input.original, snapshot.tables)) {
      if (!allowed.has(name)) {
        problems.push(
          `Turn ${snapshot.turn} changed ${name}, which the task's end state leaves as it was.`,
        );
        continue;
      }
      const now = rowCounts(snapshot.tables[name]);
      const lost = [...(kept.get(name) ?? new Map<string, number>())].find(
        ([key, count]) => (now.get(key) ?? 0) < count,
      );
      if (lost) {
        problems.push(
          `Turn ${snapshot.turn} took away a row of ${name} that the task's end state keeps.`,
        );
      }
    }
  }
  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, problems: unique, changed: finalChanged };
}
