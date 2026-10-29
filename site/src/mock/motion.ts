import type { CSSProperties } from 'react';

type MotionVars = CSSProperties & Record<`--${string}`, string | number>;

export interface Arrival {
  /** How long the arrival takes, in ms. */
  dur?: number;
  /** How far it travels from, in px (vertical or horizontal as its class says). */
  dy?: number;
  dx?: number | string;
  /** Any other variable the animation reads, such as the color it starts from. */
  vars?: Record<`--${string}`, string | number>;
}

/**
 * When a mock's element arrives: its delay in ms from the start of the chapter, and optionally
 * how long it takes and how far it comes from. The animation class says what it does.
 */
export function at(delay: number, arrival: Arrival = {}): CSSProperties {
  const style: MotionVars = { '--d': `${delay}ms`, ...arrival.vars };
  if (arrival.dur !== undefined) style['--dur'] = `${arrival.dur}ms`;
  if (arrival.dy !== undefined) style['--dy'] = `${arrival.dy}px`;
  if (arrival.dx !== undefined) {
    style['--dx'] = typeof arrival.dx === 'number' ? `${arrival.dx}px` : arrival.dx;
  }
  return style;
}
