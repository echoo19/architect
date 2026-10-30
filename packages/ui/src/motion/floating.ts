import type { Transition } from 'motion/react';
import { useEnterFrom } from './provider';
import { FLOAT_SCALE, springs } from './springs';

export interface FloatingOptions {
  /** Where the layer grows from, such as a menu's trigger: a CSS transform-origin. */
  origin?: string;
  /** How it comes in; it always leaves with the exit transition. */
  transition?: Transition;
}

/**
 * What a layer that floats above the page does as it opens and closes: it scales up from 0.97
 * while it fades in, and fades out faster than it came. Dialogs, drawers, the palette, menus,
 * popovers, tooltips and toasts all move this way.
 */
export function useFloatingMotion({ origin, transition = springs.smooth }: FloatingOptions = {}) {
  const enter = useEnterFrom({ opacity: 0, scale: FLOAT_SCALE });
  return {
    initial: enter,
    animate: { opacity: 1, scale: 1, transition },
    exit: { opacity: 0, scale: FLOAT_SCALE, transition: springs.exit },
    ...(origin === undefined ? {} : { style: { transformOrigin: origin } }),
  } as const;
}
