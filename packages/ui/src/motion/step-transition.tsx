import type { ReactNode } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useInstantMotion } from './provider';
import { springs } from './springs';

/** Which way the person is moving: on to the next page or step, or back to the one before. */
export type StepDirection = 1 | -1;

/** How far a page slides as it comes and goes. */
export const STEP_SLIDE = 24;

/** Where a page starts from, in pixels: on the side the person is moving toward. */
export function stepOffset(direction: StepDirection): number {
  return direction * STEP_SLIDE;
}

const variants: Variants = {
  enter: (direction: StepDirection) => ({ opacity: 0, x: stepOffset(direction) }),
  center: { opacity: 1, x: 0, transition: springs.smooth },
  exit: (direction: StepDirection) => ({
    opacity: 0,
    x: -stepOffset(direction),
    transition: springs.exit,
  }),
};

export interface StepTransitionProps {
  /** Identifies the page or step shown. A new key slides the new one in and the old one out. */
  transitionKey: string;
  /** `1` toward the next step, `-1` back toward the one before. */
  direction?: StepDirection;
  className?: string;
  children: ReactNode;
}

/**
 * A page or flow step. When its key changes, the new one slides in 24px from the side the person
 * is moving toward and fades in; the old one fades out and does the reverse. The old one is gone
 * before the new one starts, so the two are never on screen together. When every transition is
 * instant (tests, screenshots, reduced motion) the page changes at once, with nothing in between.
 */
export function StepTransition({
  transitionKey,
  direction = 1,
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
  return (
    <AnimatePresence mode="wait" custom={direction} initial={false}>
      <motion.div
        key={transitionKey}
        custom={direction}
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
