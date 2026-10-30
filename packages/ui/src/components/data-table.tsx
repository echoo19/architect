import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../lib/cn';

export type SortDirection = 'ascending' | 'descending';
export type SortValue = string | number | null | undefined;

export interface DataColumn<R> {
  key: string;
  header: string;
  /**
   * What the cell shows. Null or undefined means there is nothing to show, such as a score that
   * was never measured: the cell reads as absent, never as zero.
   */
  cell: (row: R) => ReactNode;
  /** Lets the column sort the table, by this value. Absent values sort last either way. */
  sortValue?: (row: R) => SortValue;
  /** Figures line up at the end. */
  align?: 'start' | 'end';
  /** A fixed width, such as `120px`; the rest share what is left. */
  width?: string;
}

export interface DataSort {
  key: string;
  direction: SortDirection;
}

export interface DataTableProps<R> {
  'aria-label': string;
  columns: readonly DataColumn<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  /** The whole row opens something; Enter does too, from the keyboard. */
  onRowClick?: (row: R) => void;
  /** The sort the table opens with. Without one, rows keep the order given. */
  initialSort?: DataSort;
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode;
  /** The height past which the body scrolls under its header. */
  maxHeight?: number;
  className?: string;
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

const absent = (value: SortValue) => value === null || value === undefined;

/**
 * The rows in a column's order. Rows with no value in that column go last whichever way, since
 * something not measured is neither high nor low; ties keep the order they came in.
 */
export function sortRows<R>(
  rows: readonly R[],
  column: Pick<DataColumn<R>, 'sortValue'> | undefined,
  direction: SortDirection,
): R[] {
  const read = column?.sortValue;
  if (!read) return [...rows];
  const sign = direction === 'ascending' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      if (absent(a.value) || absent(b.value)) {
        if (absent(a.value) && absent(b.value)) return a.index - b.index;
        return absent(a.value) ? 1 : -1;
      }
      return sign * compare(a.value, b.value) || a.index - b.index;
    })
    .map((entry) => entry.row);
}

function Absent() {
  return (
    <>
      <span aria-hidden>–</span>
      <span className="sr-only">None</span>
    </>
  );
}

/**
 * A table of records, such as the registry of models: columns sort from their headers, the
 * header stays in place while the body scrolls, and a row can open what it describes.
 */
export function DataTable<R>({
  columns,
  rows,
  rowKey,
  onRowClick,
  initialSort,
  empty,
  maxHeight,
  className,
  ...props
}: DataTableProps<R>) {
  const [sort, setSort] = useState<DataSort | undefined>(initialSort);
  const sorted = sortRows(
    rows,
    columns.find((column) => column.key === sort?.key),
    sort?.direction ?? 'ascending',
  );

  const toggle = (key: string) =>
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
        : { key, direction: 'ascending' },
    );

  return (
    <div
      className={cn('min-w-0 overflow-auto rounded-card bg-card shadow-edge', className)}
      style={maxHeight === undefined ? undefined : { maxHeight }}
    >
      <table
        aria-label={props['aria-label']}
        className="w-full border-separate border-spacing-0 text-ui tabular-nums"
      >
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key ? sort.direction : undefined;
              const Arrow = active === 'descending' ? ArrowDown : ArrowUp;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ?? (column.sortValue ? 'none' : undefined)}
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'sticky top-0 z-10 h-11 border-b border-line bg-card px-4 font-medium',
                    'first:pl-6 last:pr-6',
                    column.align === 'end' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={cn(
                        '-mx-1.5 inline-flex h-7 items-center gap-1 rounded-mark px-1.5',
                        'transition-colors duration-150 hover:bg-hover',
                        column.align === 'end' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      <Arrow
                        size={13}
                        strokeWidth={2}
                        aria-hidden
                        className={cn('transition-opacity duration-150', !active && 'opacity-0')}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={cn(
                'group/row',
                onRowClick &&
                  'cursor-pointer transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none',
              )}
            >
              {columns.map((column, index) => {
                const value = column.cell(row);
                return (
                  <td
                    key={column.key}
                    className={cn(
                      'h-12 border-t border-line px-4 first:pl-6 last:pr-6',
                      'group-first/row:border-t-0',
                      index === 0 && 'font-medium',
                      column.align === 'end' && 'text-right',
                    )}
                  >
                    {value === null || value === undefined ? <Absent /> : value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && empty !== undefined && (
        <div className="flex min-h-24 items-center justify-center px-6 py-6 text-ui">{empty}</div>
      )}
    </div>
  );
}
