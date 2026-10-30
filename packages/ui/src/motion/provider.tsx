import { createContext, useContext, type ReactNode } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { motionSettings, springs } from './springs';

const InstantMotion = createContext(false);

/** True when every transition completes at once: tests, screenshots, or reduced motion. */
export function useInstantMotion(): boolean {
  return useContext(InstantMotion);
}

export interface MotionProviderProps {
  /**
   * The app runs for tests and screenshots (ARCHITECT_HIDDEN=1): every transition completes
   * instantly, so a capture never shows a frame from the middle of an animation.
   */
  instant?: boolean;
  children: ReactNode;
}

/**
 * Mount once at the root. Everything below moves with the smooth spring unless it says
 * otherwise, and follows the system's reduced-motion setting.
 */
export function MotionProvider({ instant = false, children }: MotionProviderProps) {
  const systemReduced = useReducedMotion() ?? false;
  const settings = motionSettings({ instant, systemReduced });
  return (
    <InstantMotion.Provider value={settings.skipAnimations}>
      <MotionConfig
        transition={springs.smooth}
        reducedMotion={settings.reducedMotion}
        skipAnimations={settings.skipAnimations}
      >
        {children}
      </MotionConfig>
    </InstantMotion.Provider>
  );
}
