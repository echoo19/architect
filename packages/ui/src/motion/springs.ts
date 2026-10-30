import type { Transition } from 'motion/react';

/**
 * The three transitions the app moves with (docs/DESIGN.md, Motion). Every animation picks one:
 * `snappy` for controls, `smooth` for layout and pages, `exit` for anything leaving.
 */
export const springs = {
  /** Controls, toggles, segmented indicators and the press of a button. */
  snappy: { type: 'spring', duration: 0.25, bounce: 0.15 },
  /** Layout changes, pages, cards and disclosures. */
  smooth: { type: 'spring', duration: 0.36, bounce: 0 },
  /** Anything leaving: faster than it came. */
  exit: { type: 'tween', duration: 0.16, ease: 'easeIn' },
} as const satisfies Record<string, Transition>;

/** How far a pressed control shrinks. */
export const PRESS_SCALE = 0.97;

/** Where a dialog, menu, tooltip or toast starts its entrance from, and ends its exit at. */
export const FLOAT_SCALE = 0.97;

export interface MotionSettings {
  /** What `MotionConfig` does with the system's reduced-motion setting. */
  reducedMotion: 'user' | 'always';
  /** Every transition completes at once, with no frame in between. */
  skipAnimations: boolean;
}

/**
 * How the app moves. Tests and screenshots run it with `instant` (ARCHITECT_HIDDEN=1), so a
 * capture never shows a frame from the middle of an animation; a person whose system asks for
 * reduced motion gets the same, so nothing travels for them either.
 */
export function motionSettings(options: {
  instant: boolean;
  systemReduced: boolean;
}): MotionSettings {
  return {
    reducedMotion: options.instant ? 'always' : 'user',
    skipAnimations: options.instant || options.systemReduced,
  };
}
