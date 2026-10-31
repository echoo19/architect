import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useInstantMotion } from './provider';
import { springs } from './springs';

/** Which way the person is moving: on to the next page or step, or back to the one before. */
export type StepDirection = 1 | -1;

/**
 * What changes, which sets how far and which way it travels:
 * - `step`: a flow step (Describe, Define, Train). It slides 24px across, from the side the
 *   person is moving toward.
 * - `place`: a place or a page beside the sidebar. It rises 8px, from below when the person moves
 *   down the sidebar and from above when they move up.
 * - `tab`: a tab's content. It rises 6px as it fades in; tabs change often and sit side by side
 *   with their content below, so it doesn't travel across.
 */
export type TransitionKind = 'step' | 'place' | 'tab';

/** How far a page slides as it comes and goes, by what changes. */
export const STEP_SLIDE: Readonly<Record<TransitionKind, number>> = { step: 24, place: 8, tab: 6 };

/** Where a page starts from, in pixels: on the side the person is moving toward. */
export function stepOffset(direction: StepDirection, kind: TransitionKind = 'step'): number {
  return direction * STEP_SLIDE[kind];
}

/** Which way a move goes, from where the last page stood in its order to where the new one does. */
export function travel(from: number, to: number): StepDirection {
  return to < from ? -1 : 1;
}

/**
 * The direction of the latest change of `key`, from each key's place in an order (the sidebar's
 * places, a strip's tabs): forward when the new one comes later, back when it comes earlier.
 * `arrival` is the direction before any change, for a page that came in from somewhere else.
 */
export function useTravel(key: string, order: number, arrival: StepDirection = 1): StepDirection {
  const [last, setLast] = useState({ key, order, direction: arrival });
  if (last.key === key) return last.direction;
  const direction = travel(last.order, order);
  setLast({ key, order, direction });
  return direction;
}

interface Custom {
  direction: StepDirection;
  kind: TransitionKind;
}

/** Where a page stands, `offset` pixels from home: across for a flow step, up or down otherwise. */
const at = (kind: TransitionKind, offset: number) =>
  kind === 'step' ? { x: offset, y: 0 } : { x: 0, y: offset };

const variants: Variants = {
  enter: ({ direction, kind }: Custom) => ({
    opacity: 0,
    ...at(kind, stepOffset(kind === 'tab' ? 1 : direction, kind)),
  }),
  center: ({ kind }: Custom) => ({
    opacity: 1,
    ...at(kind, 0),
    transition: kind === 'step' ? springs.smooth : springs.settle,
  }),
  // A page that leaves only fades, and quickly, so the next one is never kept waiting.
  exit: { opacity: 0, transition: springs.leave },
};

export interface StepTransitionProps {
  /** Identifies the page or step shown. A new key slides the new one in and the old one out. */
  transitionKey: string;
  /** `1` toward the next step, `-1` back toward the one before. */
  direction?: StepDirection;
  /** What changes: a flow step, a place, or a tab's content. */
  kind?: TransitionKind;
  /**
   * Comes in on its first mount as well, for a page whose whole screen is new each step (the
   * flow's), so the step still arrives from its side.
   */
  appear?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A page, a flow step or a tab's content. When its key changes, the old one fades out quickly and
 * the new one comes in from the side the person is moving toward, so the two are never on screen
 * together. When every transition is instant (tests, screenshots, reduced motion) the page changes
 * at once, with nothing in between.
 */
export function StepTransition({
  transitionKey,
  direction = 1,
  kind = 'step',
  appear = false,
  className,
  children,
}: StepTransitionProps) {
  const instant = useInstantMotion();
  if (instant) {
    return (
      <div key={transitionKey} className={className}>
        {children}
      </div>
    );
  }
  const custom: Custom = { direction, kind };
  return (
    <AnimatePresence mode="wait" custom={custom} initial={appear}>
      <motion.div
        key={transitionKey}
        custom={custom}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
