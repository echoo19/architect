import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  Button,
  cn,
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { ChevronRight, CirclePause, Copy, FilePlus, Flag } from 'lucide-react';

/**
 * A conversation as the workspace draws it: a message from the person, the agent's steps, its
 * answer, and a change waiting for approval. Each piece takes the style that times its arrival.
 */

export function UserBubble({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <article aria-label="You" className="flex max-w-[75%] self-end">
      <p
        className={cn(
          'm-0 min-w-0 break-words rounded-[22px] bg-bubble px-[18px] py-[11px] leading-[1.55]',
          className,
        )}
        style={style}
      >
        {children}
      </p>
    </article>
  );
}

/** The agent's whole reply: steps, text, tables and cards, a screen's gap apart. */
export function Reply({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <article aria-label="Agent" className={cn('flex min-w-0 flex-col gap-[18px]', className)}>
      {children}
    </article>
  );
}

/** "Worked for 47 s", closed, as a finished reply shows its steps. */
export function WorkedFor({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        'flex h-7 max-w-full items-center gap-2 self-start text-base text-fg-secondary',
        className,
      )}
      style={style}
    >
      {children}
      <ChevronRight size={13} strokeWidth={1.8} aria-hidden className="shrink-0" />
    </span>
  );
}

export interface StepLine {
  action: string;
  target?: string;
  meta?: string;
}

/** The steps a reply took, opened: the action, what it acted on and a note. */
export function Steps({
  header,
  steps,
  hideOnNarrow = [],
  stepClassName,
  stepStyle,
  headerClassName,
  headerStyle,
}: {
  header: string;
  steps: readonly StepLine[];
  /** Steps left out where the stage is narrow, by index. */
  hideOnNarrow?: readonly number[];
  stepClassName?: string;
  stepStyle?: (index: number) => CSSProperties;
  headerClassName?: string;
  headerStyle?: CSSProperties;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span
        className={cn(
          'flex h-7 max-w-full items-center gap-2 self-start text-base text-fg-secondary',
          headerClassName,
        )}
        style={headerStyle}
      >
        {header}
        <ChevronRight size={13} strokeWidth={1.8} aria-hidden className="shrink-0 rotate-90" />
      </span>
      <ol className="m-0 ml-1.5 flex min-w-0 list-none flex-col border-l border-line-control py-0 pl-4 pr-0 leading-normal">
        {steps.map((step, index) => (
          <li
            key={`${step.action}-${step.target}`}
            className={cn(
              'flex flex-wrap items-baseline gap-x-2 gap-y-1 py-[5px]',
              hideOnNarrow.includes(index) && 'narrow:hidden',
              stepClassName,
            )}
            style={stepStyle?.(index)}
          >
            <span className="text-fg">{step.action}</span>
            {step.target && (
              <span className="font-mono text-sm text-fg-secondary">{step.target}</span>
            )}
            {step.meta && <span className="ml-1.5 text-sm text-fg-muted">{step.meta}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The answer's text: paragraphs, and a bulleted list where it has one. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col gap-3.5', className)}>{children}</div>;
}

export function P({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <p className={cn('m-0 text-pretty', className)} style={style}>
      {children}
    </p>
  );
}

export function Bullets({
  items,
  itemClassName,
  itemStyle,
}: {
  items: readonly ReactNode[];
  itemClassName?: string;
  itemStyle?: (index: number) => CSSProperties;
}) {
  return (
    <ul className="m-0 list-disc space-y-1.5 pl-6 marker:text-fg-muted">
      {items.map((item, index) => (
        <li key={index} className={cn('pl-1', itemClassName)} style={itemStyle?.(index)}>
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A table in the chat, in the product's bordered card, with its total row set apart. */
export function DataCard({
  label,
  columns,
  rows,
  note,
  footer,
  rowClassName,
  rowStyle,
  className,
  style,
}: {
  label: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  /** A full-width row of small text, such as "2 more rows: Plan discount, Tax". */
  note?: string;
  footer?: ReactNode;
  rowClassName?: string;
  rowStyle?: (index: number) => CSSProperties;
  className?: string;
  style?: CSSProperties;
}) {
  const last = rows.length - 1;
  return (
    <div className={className} style={style}>
      <TableCard
        aria-label={label}
        footer={
          footer && (
            <span className="flex h-10 w-full items-center justify-center border-t border-line-card text-base text-fg-secondary">
              {footer}
            </span>
          )
        }
      >
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead
                key={column}
                className={cn('whitespace-nowrap narrow:px-3!', index > 0 && 'text-right')}
              >
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, r) => {
            const total = r === last;
            return (
              <Fragment key={r}>
                {/* The rows that are left out sit above the total, so the sum still reads true. */}
                {total && note && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-sm first:text-fg-muted">
                      {note}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow
                  className={cn(total && '[&>td]:font-medium [&>td]:text-fg', rowClassName)}
                  style={rowStyle?.(r)}
                >
                  {row.map((cell, column) => (
                    <TableCell
                      key={column}
                      className={cn('whitespace-nowrap narrow:px-3!', column > 0 && 'text-right')}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </TableCard>
    </div>
  );
}

export interface ChangeRow {
  cells: readonly string[];
}

/**
 * A change the agent wants to make, as the workspace shows it before anything is saved: the file,
 * how much it adds, the rows it writes, and Deny, Allow all from now on and Allow once.
 */
export function ApprovalCard({
  file,
  summary,
  columns,
  rows,
  hideOnNarrow = [],
  headStyle,
  buttonsClassName,
  buttonsStyle,
  bodyClassName,
  bodyStyle,
  rowStyle,
  className,
  style,
}: {
  file: string;
  summary: string;
  columns: readonly string[];
  rows: readonly ChangeRow[];
  /** Columns left out where the stage is narrow, by position. */
  hideOnNarrow?: readonly number[];
  headStyle?: CSSProperties;
  buttonsClassName?: string;
  buttonsStyle?: CSSProperties;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
  rowStyle?: (index: number) => CSSProperties;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      role="group"
      aria-label={`Write to ${file}`}
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border border-line-control bg-card-raised leading-[1.4]',
        className,
      )}
      style={style}
    >
      <div className="flex flex-wrap items-center gap-3.5 py-3.5 pl-4 pr-3.5" style={headStyle}>
        <div className="flex min-w-0 flex-[1_1_200px] items-center gap-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-hover text-fg-secondary">
            <FilePlus size={17} strokeWidth={1.6} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
              <span className="shrink-0">Add to</span>
              <span className="truncate font-mono text-base">{file}</span>
              <ChevronRight
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className="shrink-0 rotate-90 text-fg-muted"
              />
            </span>
            <span className="text-sm text-fg-muted">{summary}</span>
          </span>
        </div>
        <div className={cn('flex gap-1.5', buttonsClassName)} style={buttonsStyle}>
          <Button variant="secondary" size="md" className="h-[38px]" tabIndex={-1}>
            Deny
          </Button>
          <Button variant="secondary" size="md" className="h-[38px] narrow:hidden" tabIndex={-1}>
            Allow all from now on
          </Button>
          <Button variant="primary" size="md" className="h-[38px]" tabIndex={-1}>
            Allow once
          </Button>
        </div>
      </div>
      <div className={cn('border-t border-line-card', bodyClassName)} style={bodyStyle}>
        <div className="overflow-hidden px-4 pb-2.5 pt-1">
          <Table variant="plain" aria-label="Rows this change writes">
            <TableHeader>
              <TableRow>
                <TableHead className="w-5">
                  <span className="sr-only">Change</span>
                </TableHead>
                {columns.map((column, index) => (
                  <TableHead
                    key={column}
                    className={cn(
                      index === columns.length - 1 && 'text-right',
                      hideOnNarrow.includes(index) && 'narrow:hidden',
                    )}
                  >
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index} className="bg-student-tint" style={rowStyle?.(index)}>
                  <TableCell className="pl-2 text-student">
                    <span aria-hidden>+</span>
                  </TableCell>
                  {row.cells.map((cell, column) => (
                    <TableCell
                      key={column}
                      className={cn(
                        'whitespace-nowrap text-fg',
                        column === row.cells.length - 1 && 'text-right',
                        hideOnNarrow.includes(column) && 'narrow:hidden',
                      )}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/** The line under a reply that is held for an answer. */
export function WaitingLine({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <p
      className={cn('m-0 flex items-center gap-2 text-base text-fg-secondary', className)}
      style={style}
    >
      <CirclePause size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
      Waiting for your approval
    </p>
  );
}

/** Copy and flag, under a settled reply. `flagged` shows the flag as pressed. */
export function ReplyActions({
  flagged,
  style,
  flagClassName,
  flagStyle,
}: {
  flagged?: boolean;
  style?: CSSProperties;
  flagClassName?: string;
  flagStyle?: CSSProperties;
}) {
  const button = 'inline-flex size-8 items-center justify-center rounded-sm text-fg-muted';
  return (
    <div className="-ml-2 -mt-2 flex" style={style}>
      <span className={button}>
        <Copy size={15} strokeWidth={1.7} aria-hidden />
      </span>
      <span className={cn(button, flagged && 'bg-hover text-fg', flagClassName)} style={flagStyle}>
        <Flag size={15} strokeWidth={1.7} aria-hidden />
      </span>
    </div>
  );
}
