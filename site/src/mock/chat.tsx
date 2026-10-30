import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@architect/ui';
import { ChevronRight } from 'lucide-react';

/**
 * A conversation as the workspace draws it: a message from the person, the steps the agent took,
 * and its answer. Each piece takes the style that times its arrival.
 */

/** Text with its order, return and pickup ids kept whole, so a line never ends on their hyphen. */
export function KeepIds({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\b(?:ORD|RT|RQ|PU)-\d+\b)/).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="whitespace-nowrap">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

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
    <article aria-label="You" className="flex max-w-[78%] self-end narrow:max-w-full">
      <p
        className={cn(
          'm-0 min-w-0 break-words rounded-[22px] bg-raised px-[18px] py-[11px] text-body text-pretty',
          className,
        )}
        style={style}
      >
        {children}
      </p>
    </article>
  );
}

/** The agent's whole reply: its steps, its words and what it shows, a screen's gap apart. */
export function Reply({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <article
      aria-label="Agent"
      className={cn('flex min-w-0 flex-col gap-4 text-body', className)}
      style={style}
    >
      {children}
    </article>
  );
}

/** "Worked for 47 s, 3 steps", closed, as a finished reply shows its steps. */
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
      className={cn('flex h-7 max-w-full items-center gap-1.5 self-start text-ui', className)}
      style={style}
    >
      {children}
      <ChevronRight size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
    </span>
  );
}

export interface StepLine {
  action: string;
  target: string;
}

/** The steps a reply took, opened: what it did and to which file. */
export function Steps({
  header,
  steps,
  headerClassName,
  headerStyle,
  stepClassName,
  stepStyle,
}: {
  header: string;
  steps: readonly StepLine[];
  headerClassName?: string;
  headerStyle?: CSSProperties;
  stepClassName?: string;
  stepStyle?: (index: number) => CSSProperties;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={cn('flex h-7 items-center gap-1.5 self-start text-ui', headerClassName)}
        style={headerStyle}
      >
        {header}
        <ChevronRight size={14} strokeWidth={1.8} aria-hidden className="shrink-0 rotate-90" />
      </span>
      <ol className="m-0 ml-1.5 flex list-none flex-col border-l border-line-strong py-0 pl-4 pr-0">
        {steps.map((step, index) => (
          <li
            key={`${step.action}-${step.target}`}
            className={cn('flex items-baseline gap-2.5 py-[5px] text-ui', stepClassName)}
            style={stepStyle?.(index)}
          >
            <span>{step.action}</span>
            <span className="font-mono text-small">{step.target}</span>
          </li>
        ))}
      </ol>
    </div>
  );
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

/**
 * A short table of what the agent worked out: a name, then rows of a thing and its figure, split
 * by hairlines, the last row set heavier because it is the answer.
 */
export function Ledger({
  title,
  rows,
  className,
  style,
  rowClassName,
  rowStyle,
}: {
  title: string;
  rows: readonly (readonly [string, string])[];
  className?: string;
  style?: CSSProperties;
  rowClassName?: string;
  rowStyle?: (index: number) => CSSProperties;
}) {
  return (
    <figure
      className={cn('m-0 overflow-hidden rounded-control shadow-edge', className)}
      style={style}
    >
      <figcaption className="px-4 pb-1.5 pt-3 font-medium">{title}</figcaption>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map(([label, value], index) => {
          const last = index === rows.length - 1;
          return (
            <li
              key={label}
              className={cn(
                'flex min-h-10 items-center justify-between gap-6 border-t border-line px-4 tabular-nums',
                last && 'font-medium',
                rowClassName,
              )}
              style={rowStyle?.(index)}
            >
              <span>{label}</span>
              <span>{value}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
