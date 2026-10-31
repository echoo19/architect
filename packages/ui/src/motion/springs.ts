import type { Transition } from 'motion/react';

/**
 * The transitions the app moves with (docs/DESIGN.md, Motion). Every animation picks one:
 * `snappy` for controls, `smooth` for layout and flow steps, `settle` for what changes often (a
 * place, a tab's content, the selected row), `exit` for anything leaving and `leave` for a page
 * making way for the next.
 */
export const springs = {
  /** Controls, toggles, segmented indicators and the press of a button. */
  snappy: { type: 'spring', duration: 0.25, bounce: 0.15 },
  /** Layout changes, flow steps, cards and disclosures. */
  smooth: { type: 'spring', duration: 0.36, bounce: 0 },
  /** What a person changes many times a minute: a place, a tab's content, the sidebar's row. */
  settle: { type: 'spring', duration: 0.28, bounce: 0 },
  /** Anything leaving: faster than it came. */
  exit: { type: 'tween', duration: 0.16, ease: 'easeIn' },
  /** A page or a tab's content making way for the next: a quick fade, so nothing waits on it. */
  leave: { type: 'tween', duration: 0.1, ease: 'easeIn' },
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
