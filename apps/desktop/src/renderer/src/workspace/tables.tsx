import type { CellValue, RowDiff } from '@architect/shared';
import { cn, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@architect/ui';
import { diffLines, type DiffLine } from './diff';
import { cellText, isFigureColumn, isTotalRow } from './labels';

/** A row that sums the ones above it stands out from them. */
export const TOTAL_ROW = '[&>td]:font-medium [&>td]:text-fg';

export interface DataTableProps {
  label: string;
  columns: string[];
  rows: CellValue[][];
}

/** A full table in the side panel, in the panel's mono style. */
export function DataTable({ label, columns, rows }: DataTableProps) {
  const align = (column: number) => isFigureColumn(rows, column) && 'text-right';
  return (
    <Table variant="plain" aria-label={label}>
      <TableHeader>
        <TableRow>
          {columns.map((column, index) => (
            <TableHead key={column} className={cn(align(index))}>
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, r) => (
          <TableRow key={r} className={cn(isTotalRow(row) && TOTAL_ROW)}>
            {columns.map((_, column) => (
              <TableCell key={column} className={cn(align(column))}>
                {cellText(row[column] ?? null)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const MARKS: Record<DiffLine['kind'], { symbol: string; label: string; className: string }> = {
  added: { symbol: '+', label: 'Added', className: 'bg-student-tint' },
  after: { symbol: '+', label: 'After', className: 'bg-student-tint' },
  removed: { symbol: '−', label: 'Removed', className: 'bg-danger-tint' },
  before: { symbol: '−', label: 'Before', className: 'bg-danger-tint' },
};

function markTone(kind: DiffLine['kind']): string {
  return kind === 'added' || kind === 'after'
    ? 'text-student first:text-student'
    : 'text-danger first:text-danger';
}

function cellTone(line: DiffLine, column: number): string {
  const changed = line.changed[column];
  if (line.kind === 'added' || line.kind === 'after') {
    return changed ? 'text-fg' : 'text-fg-secondary';
  }
  return changed ? 'text-fg-muted line-through decoration-fg-faint' : 'text-fg-muted';
}

export interface RowDiffTableProps {
  diff: RowDiff;
  /** Show only the first lines, e.g. in a chat card. */
  limit?: number;
  className?: string;
}

/** The rows a write would add, remove or change, with added rows marked. */
export function RowDiffTable({ diff, limit, className }: RowDiffTableProps) {
  const lines = diffLines(diff);
  const cells = lines.map((line) => line.cells);
  const align = (column: number) => isFigureColumn(cells, column) && 'text-right';
  return (
    <Table variant="plain" aria-label="Rows this change writes" className={className}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-5">
            <span className="sr-only">Change</span>
          </TableHead>
          {diff.columns.map((column, index) => (
            <TableHead key={column} className={cn(align(index))}>
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {(limit === undefined ? lines : lines.slice(0, limit)).map((line, index) => {
          const mark = MARKS[line.kind];
          return (
            <TableRow key={index} className={mark.className}>
              <TableCell className={cn('pl-2', markTone(line.kind))}>
                <span aria-hidden>{mark.symbol}</span>
                <span className="sr-only">{mark.label}</span>
              </TableCell>
              {line.cells.map((cell, column) => (
                <TableCell key={column} className={cn(cellTone(line, column), align(column))}>
                  {cellText(cell)}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
