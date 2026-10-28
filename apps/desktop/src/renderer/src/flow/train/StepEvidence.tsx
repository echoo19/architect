import type { CellValue, JsonValue, RowDiff, TableView, WriteRecord } from '@architect/shared';
import {
  Disclosure,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { CodeView } from '../../components/CodeView';
import { PatchLines } from '../../components/PatchLines';
import { cellText } from '../../workspace/labels';
import { RowDiffTable } from '../../workspace/tables';
import type { ToolTraceStep } from './trace-steps';

/** Long results scroll; past this many rows the rest are counted, not drawn. */
const ROW_LIMIT = 50;

/** Past this many columns, one row written reads as its fields, top to bottom, not a wide table. */
const WIDE_ROW = 4;

/**
 * What one tool call gave back, as evidence: code with its output, a change with its rows or
 * lines, a table read with its rows, or the text as the agent saw it. The raw call is folded
 * under it.
 */
export function CallEvidence({ step }: { step: ToolTraceStep }) {
  const code =
    step.name === 'run' && typeof step.arguments.code === 'string'
      ? step.arguments.code
      : undefined;
  let body;
  if (code !== undefined) {
    body = (
      <CodeView
        code={code}
        output={step.error ?? resultText(step.result)}
        failed={step.error !== undefined}
      />
    );
  } else if (step.error) {
    body = <span className="whitespace-pre-wrap text-sm text-danger">{step.error}</span>;
  } else if (step.change) {
    body = <ChangeResult change={step.change} text={resultText(step.result)} />;
  } else if (step.table) {
    body = <TableResult table={step.table} />;
  } else if (typeof step.result === 'string') {
    body = <TextResult text={step.result} />;
  } else {
    body = <ToolResult result={step.result} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {body}
      <Disclosure label="Raw call">
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-well px-3 py-2 font-mono text-xs text-fg-secondary">
          {`${step.name} ${JSON.stringify(step.arguments, null, 2)}`}
        </pre>
      </Disclosure>
    </div>
  );
}

function resultText(result: JsonValue | null): string {
  if (result === null) return 'No result';
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

/** Text a tool gave back, such as a file's numbered lines, as it reads. */
function TextResult({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-well px-3 py-2 font-mono text-xs text-fg-secondary">
      {text}
    </pre>
  );
}

/** What a change did, in the tool's words, and the rows or lines it wrote. */
function ChangeResult({ change, text }: { change: WriteRecord; text: string }) {
  const single = change.rows ? singleRow(change.rows) : null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-sm text-fg-secondary">{text}</span>
      {single && change.rows ? (
        // One row's fields are as many as its columns, so all of them stay in view.
        <div className="rounded-md bg-well px-1 py-1">
          <RowFields columns={change.rows.columns} {...single} />
        </div>
      ) : (
        <div className="max-h-56 overflow-auto rounded-md bg-well px-1 py-1">
          {change.rows ? (
            <RowDiffTable diff={change.rows} className="text-xs" />
          ) : (
            <PatchLines patch={change.patch} label="Lines this change writes" />
          )}
        </div>
      )}
    </div>
  );
}

/** The one row a change added or changed, when it is too wide for a table; else null. */
function singleRow(diff: RowDiff): { after: CellValue[]; before: CellValue[] | null } | null {
  if (diff.columns.length <= WIDE_ROW) return null;
  if (diff.added.length + diff.removed.length + diff.changed.length !== 1) return null;
  const [added] = diff.added;
  if (added) return { after: added, before: null };
  const [changed] = diff.changed;
  return changed ? { after: changed.after, before: changed.before } : null;
}

/** One row as its fields, every column in view, with a changed field's old value struck out. */
function RowFields({
  columns,
  after,
  before,
}: {
  columns: readonly string[];
  after: CellValue[];
  before: CellValue[] | null;
}) {
  return (
    <dl
      aria-label={before ? 'The row this change edits' : 'The row this change adds'}
      className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 px-2.5 py-1.5 font-mono text-xs"
    >
      {columns.map((column, at) => {
        const now = cellText(after[at] ?? null);
        const was = before ? cellText(before[at] ?? null) : now;
        return (
          <div key={column} className="contents">
            <dt className="text-fg-muted">{column}</dt>
            <dd className="m-0 break-words text-fg">
              {was !== now && (
                <>
                  <span className="text-fg-muted line-through decoration-fg-faint">{was}</span>{' '}
                </>
              )}
              {now}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The rows a table read showed. */
function TableResult({ table }: { table: TableView }) {
  return (
    <div className="max-h-56 overflow-auto rounded-md bg-well px-3 py-1">
      <Table variant="plain" className="text-xs">
        <TableHeader>
          <TableRow>
            {table.columns.map((column) => (
              <TableHead key={column} className="whitespace-nowrap">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.slice(0, ROW_LIMIT).map((row, index) => (
            <TableRow key={index}>
              {table.columns.map((column, at) => (
                <TableCell key={column} className="whitespace-nowrap">
                  {row[at] ?? ''}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {table.rows.length > ROW_LIMIT && (
        <p className="m-0 py-2 text-xs text-fg-muted">{table.rows.length - ROW_LIMIT} more rows</p>
      )}
    </div>
  );
}

type Cell = string | number | boolean | null;

/** Rows of a table, when a tool returned a list of flat records; otherwise null. */
function asRows(value: JsonValue | null): Record<string, Cell>[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: Record<string, Cell>[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const cells = Object.values(item);
    if (cells.some((cell) => cell !== null && typeof cell === 'object')) return null;
    rows.push(item as Record<string, Cell>);
  }
  return rows;
}

/** A result from before the coding tools, or a helper's JSON: rows as a table, else JSON. */
function ToolResult({ result }: { result: JsonValue | null }) {
  const rows = asRows(result);
  if (!rows) {
    return (
      <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-well px-3 py-2 font-mono text-xs text-fg-secondary">
        {result === null ? 'No result' : JSON.stringify(result, null, 2)}
      </pre>
    );
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    <div className="max-h-56 overflow-auto rounded-md bg-well px-3 py-1">
      <Table variant="plain" className="text-xs">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, ROW_LIMIT).map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell key={column}>{String(row[column] ?? '–')}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > ROW_LIMIT && (
        <p className="m-0 py-2 text-xs text-fg-muted">{rows.length - ROW_LIMIT} more rows</p>
      )}
    </div>
  );
}
