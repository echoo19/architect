import { useId, useState } from 'react';
import type { AgentStep, StepView, WorkspaceMessage } from '@architect/shared';
import {
  cn,
  Collapse,
  Reveal,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { ChevronRight, Layers } from 'lucide-react';
import { CodeView } from '../components/CodeView';
import { cellText, currentStep, isFigureColumn, stepCount, stepWords, workedLabel } from './labels';
import type { PanelContent } from './SidePanel';

/** A step reads in the ink of the text around it, unless it failed. */
const NAME_TONE: Partial<Record<AgentStep['status'], string>> = { error: 'text-danger' };

/** Rows a table read shows under its step before "Show all". */
const STEP_TABLE_ROWS = 4;

export interface StepsProps {
  message: WorkspaceMessage;
  /** Whether the list starts open, from the "Tool steps" setting. */
  startOpen: boolean;
  /** The reply is held until the user answers a write it wants to make. */
  waiting: boolean;
  onOpenPanel: (content: PanelContent) => void;
}

/** "Read data/jobs.csv": a step's action and what it acted on, as one line of text. */
function stepLine(step: AgentStep): string {
  const { action, target } = stepWords(step);
  return target === '' ? action : `${action} ${target}`;
}

/**
 * The tools and skills an agent used. While it works, the header names the current step;
 * afterwards it says how long the work took. The list opens as the "Tool steps" setting says.
 * A table read shows the rows it read, and code shows what it gave back.
 */
export function Steps({ message, startOpen, waiting, onOpenPanel }: StepsProps) {
  const listId = useId();
  const [choice, setChoice] = useState<boolean | null>(null);
  const working = message.status === 'streaming';
  const open = choice ?? startOpen;
  const step = working ? currentStep(message.steps) : undefined;

  // The header says what the work is, then how long it took; the steps themselves are one click
  // away. While a write waits for an answer, the line under the reply says so; this one counts.
  let header = workedLabel(message);
  if (working && waiting) header = `${stepCount(message.steps.length)} so far`;
  else if (step) header = stepLine(step);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setChoice(!open)}
        className="flex h-7 max-w-full items-center gap-2 self-start rounded-mark text-ui text-fg transition-colors duration-150"
      >
        {working && !waiting && <Spinner size={13} />}
        <span className="truncate">{header}</span>
        <ChevronRight
          size={13}
          strokeWidth={1.8}
          aria-hidden
          className={cn('shrink-0 transition-transform duration-200', open && 'rotate-90')}
        />
      </button>
      <Collapse open={open} id={listId}>
        <ol
          aria-label="Steps"
          className="m-0 ml-1.5 flex min-w-0 list-none flex-col border-l border-line-strong py-0 pl-4 pr-0 text-small leading-normal"
        >
          {message.steps.map((item) => {
            const { action, target } = stepWords(item);
            // Code shows its own output, so its one-line summary would only repeat it.
            const meta = item.view?.kind === 'code' ? undefined : item.meta;
            return (
              <Reveal as="li" key={item.id} className="flex min-w-0 flex-col gap-2 py-[5px]">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={NAME_TONE[item.status]}>{action}</span>
                  {target !== '' && <span className="font-mono text-fg">{target}</span>}
                  {meta && (
                    <span
                      className={item.status === 'error' ? 'ml-1.5 text-danger' : 'ml-1.5 text-fg'}
                    >
                      {meta}
                    </span>
                  )}
                </div>
                {item.view && (
                  <StepDetail
                    view={item.view}
                    title={item.detail}
                    failed={item.status === 'error'}
                    onOpenPanel={onOpenPanel}
                  />
                )}
              </Reveal>
            );
          })}
          {message.graduateVersion !== undefined && (
            <li className="flex items-center gap-2 py-[5px] text-fg">
              <Layers size={13} strokeWidth={1.8} aria-hidden className="shrink-0" />
              Answered by version {message.graduateVersion}
            </li>
          )}
        </ol>
      </Collapse>
    </div>
  );
}

function StepDetail({
  view,
  title,
  failed,
  onOpenPanel,
}: {
  view: StepView;
  title: string;
  failed: boolean;
  onOpenPanel: (content: PanelContent) => void;
}) {
  if (view.kind === 'code') {
    return <CodeView code={view.code} output={view.output} failed={failed} />;
  }
  return <StepTable view={view} title={title} onOpenPanel={onOpenPanel} />;
}

/** The first rows a table read showed, with the rest a click away in the side panel. */
function StepTable({
  view,
  title,
  onOpenPanel,
}: {
  view: Extract<StepView, { kind: 'table' }>;
  title: string;
  onOpenPanel: (content: PanelContent) => void;
}) {
  const shown = view.rows.slice(0, STEP_TABLE_ROWS);
  const align = (column: number) => isFigureColumn(view.rows, column) && 'text-right';
  return (
    <div className="min-w-0 overflow-hidden rounded-control bg-field">
      <div className="overflow-x-auto px-3">
        <Table variant="plain" aria-label={title} className="text-small">
          <TableHeader>
            <TableRow>
              {view.columns.map((column, index) => (
                <TableHead key={column} className={cn('whitespace-nowrap', align(index))}>
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row, r) => (
              <TableRow key={r}>
                {view.columns.map((_, column) => (
                  <TableCell key={column} className={cn('whitespace-nowrap', align(column))}>
                    {cellText(row[column] ?? null)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {view.rows.length > STEP_TABLE_ROWS && (
        <button
          type="button"
          className="h-8 w-full border-t border-line text-small text-fg transition-colors duration-150 hover:bg-hover"
          onClick={() =>
            onOpenPanel({ kind: 'table', title, columns: view.columns, rows: view.rows })
          }
        >
          Show all {view.rows.length} rows
        </button>
      )}
    </div>
  );
}
