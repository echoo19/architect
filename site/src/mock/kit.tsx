import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@architect/ui';
import { at } from './motion';

/**
 * The few pieces every mock arranges its motion from. Each one takes when it starts, in ms from the
 * start of the chapter, and plays in CSS alone (see motion.css), so a chapter can be seeked to any
 * frame.
 */

/**
 * A row that is made room for. Its wrapper is a one-row grid whose height opens as the row comes
 * in, so what is below it moves down to make space instead of jumping.
 */
export function Insert({
  start,
  dur = 620,
  dy,
  className,
  children,
}: {
  start: number;
  dur?: number;
  dy?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('a a-insert grid grid-rows-[1fr]', className)}
      style={at(start, { dur, ...(dy === undefined ? {} : { dy }) })}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** One figure or line of a stack that rolls from one to the next: when it comes, and its content. */
export interface RollStep {
  at: number;
  content: ReactNode;
}

/**
 * A figure that rolls up to its next value: the old one leaves upward as the new one arrives from
 * below, in the same place. Only the last is in the finished picture.
 */
export function Roll({
  steps,
  className,
  dur = 520,
}: {
  steps: readonly RollStep[];
  className?: string;
  dur?: number;
}) {
  return (
    <span className={cn('grid overflow-hidden', className)}>
      {steps.map((step, index) => {
        const next = steps[index + 1];
        const arriving: CSSProperties | undefined = index > 0 ? at(step.at, { dur }) : undefined;
        return (
          <span
            key={index}
            className={cn('[grid-area:1/1]', index > 0 && 'a a-roll-in', next && 'motion-only')}
            style={arriving}
          >
            {next ? (
              <span className="a a-roll-out block" style={at(next.at - 60, { dur: 300 })}>
                {step.content}
              </span>
            ) : (
              step.content
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Words that arrive a few at a time, as a person's typing does. */
export function Typed({ text, start, step = 40 }: { text: string; start: number; step?: number }) {
  return (
    <>
      {text.split(' ').map((word, index) => (
        <span
          key={index}
          className="a a-fade inline-block whitespace-pre"
          style={at(start + index * step, { dur: 220 })}
        >
          {word}{' '}
        </span>
      ))}
    </>
  );
}

/** A name set in a model's own color: Spark in amber, Glimmer in blue. */
export function Model({ name }: { name: 'Spark' | 'Glimmer' }) {
  return <span className={name === 'Spark' ? 'text-mentor' : 'text-student'}>{name}</span>;
}

/**
 * Two versions of one control in one place, the second taking over at a moment: a button that
 * presses and becomes done, a field that fills. Only the second is in the finished picture.
 */
export function Swap({
  at: moment,
  before,
  after,
  dur = 260,
  className,
}: {
  at: number;
  before: ReactNode;
  after: ReactNode;
  dur?: number;
  className?: string;
}) {
  return (
    <span className={cn('grid', className)}>
      <span
        className="a a-exit-up motion-only [grid-area:1/1]"
        style={at(moment - 40, { dur: Math.round(dur / 2), dy: 0 })}
      >
        {before}
      </span>
      <span className="a a-pop [grid-area:1/1]" style={at(moment, { dur })}>
        {after}
      </span>
    </span>
  );
}
