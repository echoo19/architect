import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { Tooltip } from './tooltip';

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
  /**
   * A name shared by columns side by side, such as "Final test" over Seen, Unseen and Real. It
   * heads them in a row above their own headers.
   */
  group?: string;
  /** What the header means, in a sentence, shown on hover or focus of the header. */
  hint?: string;
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
  /** The row open beside the table, such as in an inspector: it keeps the selected fill. */
  selectedKey?: string;
  className?: string;
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

const absent = (value: SortValue) => value === null || value === undefined;

/** Runs of side-by-side columns under one group name; a column with none is a run of its own. */
export function columnGroups<R>(
  columns: readonly Pick<DataColumn<R>, 'key' | 'group'>[],
): { key: string; group: string | undefined; span: number }[] {
  const runs: { key: string; group: string | undefined; span: number }[] = [];
  for (const column of columns) {
    const last = runs.at(-1);
    if (last && column.group !== undefined && last.group === column.group) last.span += 1;
    else runs.push({ key: column.key, group: column.group, span: 1 });
  }
  return runs;
}

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
  selectedKey,
  className,
  ...props
}: DataTableProps<R>) {
  const groups = columns.some((column) => column.group !== undefined)
    ? columnGroups(columns)
    : null;
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
      className={cn('min-w-0 overflow-auto rounded-card surface-card scroll-quiet', className)}
      style={maxHeight === undefined ? undefined : { maxHeight }}
    >
      <table
        aria-label={props['aria-label']}
        className="w-full border-separate border-spacing-0 text-ui tabular-nums"
      >
        <thead className="sticky top-0 z-10">
          {groups && (
            <tr>
              {groups.map((run) => (
                <th
                  key={run.key}
                  scope={run.group ? 'colgroup' : undefined}
                  colSpan={run.span}
                  className="bg-card px-3 pt-3 text-center text-small font-normal first:pl-6 last:pr-6"
                >
                  {run.group && (
                    <span className="block border-b border-line pb-1.5">{run.group}</span>
                  )}
                </th>
              ))}
            </tr>
          )}
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
                    'h-11 whitespace-nowrap border-b border-line bg-card px-3 font-medium',
                    'first:pl-6 last:pr-6',
                    column.align === 'end' ? 'text-right' : 'text-left',
                  )}
                >
                  <HeaderHint hint={column.hint}>
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
                      <span tabIndex={column.hint ? 0 : undefined}>{column.header}</span>
                    )}
                  </HeaderHint>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              aria-current={selectedKey === rowKey(row) ? 'true' : undefined}
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
                selectedKey === rowKey(row) && 'bg-selected',
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
                      'h-12 border-t border-line px-3 first:pl-6 last:pr-6',
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

/** A header with a hint: the tooltip opens from the header itself. */
function HeaderHint({ hint, children }: { hint: string | undefined; children: ReactNode }) {
  return hint ? <Tooltip content={hint}>{children}</Tooltip> : <>{children}</>;
}
