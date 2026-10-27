import type { CellValue, RowDiff } from '@architect/shared';

/** One row of a write's preview: an added or removed row, or one side of a changed row. */
export interface DiffLine {
  kind: 'added' | 'removed' | 'before' | 'after';
  cells: CellValue[];
  /** Per column, whether this cell is part of the change. */
  changed: boolean[];
}

/** Changed rows first, as a before and an after line, then removed rows, then added ones. */
export function diffLines(diff: RowDiff): DiffLine[] {
  const width = diff.columns.length;
  const cellsOf = (row: CellValue[]) => diff.columns.map((_, column) => row[column] ?? null);
  const whole = Array.from({ length: width }, () => true);
  return [
    ...diff.changed.flatMap(({ before, after }) => {
      const changed = diff.columns.map(
        (_, column) => (before[column] ?? null) !== (after[column] ?? null),
      );
      return [
        { kind: 'before' as const, cells: cellsOf(before), changed },
        { kind: 'after' as const, cells: cellsOf(after), changed },
      ];
    }),
    ...diff.removed.map((row) => ({
      kind: 'removed' as const,
      cells: cellsOf(row),
      changed: whole,
    })),
    ...diff.added.map((row) => ({ kind: 'added' as const, cells: cellsOf(row), changed: whole })),
  ];
}

/** How many rows a write adds, removes or changes. */
export function diffRowCount(diff: RowDiff): number {
  return diff.added.length + diff.removed.length + diff.changed.length;
}
